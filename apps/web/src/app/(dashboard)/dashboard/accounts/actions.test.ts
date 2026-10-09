import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The first test file for the agency's account-creation action. It covers the
 * function's exits: the three refusals an operator can act on (a blank name
 * and an unusable timezone, both refused before Clerk is touched, and a
 * test-shaped org id, refused after Clerk with the organisation rolled back),
 * each of which RETURNS `{ ok: false, error }` for the create dialog to show;
 * the unexpected failures, which still THROW so the dialog falls back to its
 * generic toast; and the happy path, which ends in `redirect`.
 *
 * Mock shape copied from `[accountId]/automations/actions.test.ts:1-16`:
 * `@bis/db` keeps its real exports (so `assertUsableZone` and `isTestOrgId`
 * are the REAL ones — the guard under test must not be able to pass because
 * a spy said so) with only the two write calls spied, and `serviceDb`
 * stubbed to an object nothing dereferences.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ createAccount: vi.fn(), applyBlueprint: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_agency" }) }));
const clerkMocks = vi.hoisted(() => ({ createOrg: vi.fn(), deleteOrg: vi.fn(), getOrg: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      createOrganization: clerkMocks.createOrg,
      deleteOrganization: clerkMocks.deleteOrg,
      getOrganization: clerkMocks.getOrg,
    },
  }),
}));

import { redirect } from "next/navigation";
import { m } from "@/lib/messages";
import { NO_BLUEPRINT_SENTINEL } from "./constants";
import { createClientAccount, adoptOrphanOrgAction } from "./actions";

/** What a real Clerk organisation id looks like: `org_` plus base58. */
const CLERK_ORG_ID = "org_2abcDEFghiJKL";

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("name", "Rio Roofing");
  f.set("brandName", "Rio Roofing");
  f.set("timezone", "America/Chicago");
  f.set("blueprintId", NO_BLUEPRINT_SENTINEL);
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.mocked(redirect).mockReset();
  dbMocks.createAccount.mockReset().mockResolvedValue({ id: "acct_1" });
  dbMocks.applyBlueprint.mockReset().mockResolvedValue({ failed: [] });
  clerkMocks.createOrg.mockReset().mockResolvedValue({ id: CLERK_ORG_ID });
  clerkMocks.deleteOrg.mockReset().mockResolvedValue(undefined);
  clerkMocks.getOrg.mockReset().mockResolvedValue({ id: CLERK_ORG_ID, name: "Rio Roofing" });
});

/**
 * Owner decision 2026-10-09: Add company asks for the name customers see as
 * its own field. The business name stays the agency's private label; the
 * brand name is what brand_name and the Clerk organisation (whose name
 * invitation emails carry, D-005) are born with.
 */
describe("createClientAccount — the name customers see", () => {
  it("creates the Clerk organisation under the BRAND name and stores it as brand_name, the business name as the private label (mutation: org named from name → FAILS; brandName dropped → FAILS)", async () => {
    await createClientAccount(form({ name: "Rio Roofing — trial", brandName: "  Rio Roofing  " }));
    expect(clerkMocks.createOrg).toHaveBeenCalledWith({ name: "Rio Roofing", createdBy: "user_agency" });
    expect(dbMocks.createAccount.mock.calls[0]?.[1]).toMatchObject({
      name: "Rio Roofing — trial", brandName: "Rio Roofing",
    });
  });

  it("refuses a blank brand name before Clerk is touched (mutation: drop the check → FAILS)", async () => {
    expect(await createClientAccount(form({ brandName: "   " })))
      .toEqual({ ok: false, error: m["accounts.brandNameRequired"] });
    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });
});

describe("createClientAccount", () => {
  it("creates the account under the id Clerk minted", async () => {
    await createClientAccount(form());

    expect(dbMocks.createAccount).toHaveBeenCalledTimes(1);
    expect(dbMocks.createAccount.mock.calls[0]?.[1]).toMatchObject({ clerkOrgId: CLERK_ORG_ID });
    expect(clerkMocks.deleteOrg).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/dashboard/accounts/acct_1/setup");
  });

  it("refuses a test-shaped org id with words the operator reads, and takes the Clerk organisation with it", async () => {
    // The fixture sweep deletes any account whose clerk_org_id starts with
    // `org_test_` once it is an hour old (packages/db/src/test/sweep-fixtures.ts).
    // If production could ever mint one, a real business's account would
    // disappear overnight — so this is refused at the door, and the Clerk
    // organisation is rolled back so nothing is left half-made. RETURNED, not
    // thrown: a throw reaches the dialog as the generic "Check the name" toast,
    // which sends the operator to fix a name that was never the problem.
    clerkMocks.createOrg.mockResolvedValue({ id: "org_test_evil" });
    // The refusal leaves a server-side line (the old throw did, via Next's
    // own error log); silenced here so the run stays readable.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(createClientAccount(form())).resolves.toEqual({
        ok: false, error: m["accounts.createRefusedTestOrgId"],
      });

      expect(dbMocks.createAccount).not.toHaveBeenCalled();
      expect(clerkMocks.deleteOrg).toHaveBeenCalledTimes(1);
      expect(clerkMocks.deleteOrg).toHaveBeenCalledWith("org_test_evil");
      expect(redirect).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs the rollback's own failure instead of swallowing it silently", async () => {
    // "Nothing was saved." in the refusal is a lie if the Clerk org survives
    // because the compensating rollback itself failed — orphans.ts surfaces
    // that later, but only if this log exists to find. Matched on the
    // rollback's own wording, not just the org id, so a separate log line
    // that happens to name the id cannot satisfy it.
    clerkMocks.createOrg.mockResolvedValue({ id: "org_test_evil" });
    clerkMocks.deleteOrg.mockRejectedValue(new Error("clerk is down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(createClientAccount(form())).resolves.toEqual({
        ok: false, error: m["accounts.createRefusedTestOrgId"],
      });

      expect(
        errorSpy.mock.calls.some((call) =>
          call.some((arg) => typeof arg === "string"
            && arg.includes("compensating rollback failed") && arg.includes("org_test_evil")),
        ),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("refuses an unusable timezone before it makes a Clerk organisation, naming what was typed", async () => {
    await expect(createClientAccount(form({ timezone: "Mars/Olympus" }))).resolves.toEqual({
      ok: false, error: m["accounts.timezoneUnusable"].replace("{zone}", "Mars/Olympus"),
    });

    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("asks for a timezone instead of quoting a blank one", async () => {
    // The `?? "America/Chicago"` fallback only covers a MISSING field; a
    // field left empty in the form arrives here as "", which used to fall
    // straight into assertUsableZone and come back as the unusable-zone
    // copy quoting an empty string: `"" is not a timezone we can use…`.
    await expect(createClientAccount(form({ timezone: "" }))).resolves.toEqual({
      ok: false, error: m["accounts.timezoneRequired"],
    });

    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("refuses a name that is only spaces before it makes a Clerk organisation", async () => {
    // The input's `required` stops an EMPTY field in the browser, but not one
    // holding only spaces — the action trims, so that reaches here as "".
    await expect(createClientAccount(form({ name: "   " }))).resolves.toEqual({
      ok: false, error: m["accounts.nameRequired"],
    });

    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("still THROWS when the database write fails, after rolling the Clerk organisation back", async () => {
    // Not a refusal the operator can act on, so it is not dressed as one: the
    // dialog's generic toast is the honest answer.
    dbMocks.createAccount.mockRejectedValue(new Error("db is down"));

    await expect(createClientAccount(form())).rejects.toThrow("db is down");

    expect(clerkMocks.deleteOrg).toHaveBeenCalledWith(CLERK_ORG_ID);
  });

  it("still THROWS when Clerk itself fails — a Clerk failure never reads as a timezone refusal", async () => {
    // Pins that the zone check's `try` is wrapped around assertUsableZone
    // alone: widened over createOrganization, this rejection would come back
    // as `{ ok: false }` with the timezone copy.
    clerkMocks.createOrg.mockRejectedValue(new Error("clerk is down"));

    await expect(createClientAccount(form())).rejects.toThrow("clerk is down");

    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });
});

/**
 * D-087: the half-created-company warning told the agency to "add the company
 * here with the same name" — which runs createClientAccount, mints a SECOND
 * Clerk organisation, and leaves everyone already invited in the first one,
 * still unable to sign in. Adopting links the organisation that exists.
 */
describe("adoptOrphanOrgAction (D-087)", () => {
  const tz = (zone = "America/Chicago") => { const f = new FormData(); f.set("timezone", zone); return f; };

  it("creates the account on the EXISTING organisation, under its own Clerk name, and never creates a second one (mutation: call createOrganization → FAILS; use a typed name → FAILS)", async () => {
    await adoptOrphanOrgAction(CLERK_ORG_ID, tz("America/Denver"));
    expect(clerkMocks.getOrg).toHaveBeenCalledWith({ organizationId: CLERK_ORG_ID });
    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).toHaveBeenCalledOnce();
    expect(dbMocks.createAccount.mock.calls[0]?.[1]).toEqual({
      clerkOrgId: CLERK_ORG_ID, name: "Rio Roofing", timezone: "America/Denver", actorId: "user_agency",
    });
    // Lands on the Client access card, not setup (review): an adopted account
    // is born with client access OFF, so the people already invited cannot
    // sign in until it is turned on — the step the hint names.
    expect(redirect).toHaveBeenCalledWith("/dashboard/accounts/acct_1/settings#client-access");
  });

  it("never deletes the organisation when the account write fails: it was not this action's to delete (mutation: reuse createClientAccount's rollback → FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.createAccount.mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    expect(await adoptOrphanOrgAction(CLERK_ORG_ID, tz()))
      .toEqual({ ok: false, error: m["accounts.orphan.adoptFailed"] });
    expect(clerkMocks.deleteOrg).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuses an organisation Clerk no longer has, writing nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    clerkMocks.getOrg.mockRejectedValue(new Error("not found"));
    expect(await adoptOrphanOrgAction("org_gone", tz()))
      .toEqual({ ok: false, error: m["accounts.orphan.adoptGone"] });
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("refuses a test-shaped org id (the fixture sweep would delete the account within the hour), writing nothing", async () => {
    clerkMocks.getOrg.mockResolvedValue({ id: "org_test_x", name: "E2E Co" });
    expect(await adoptOrphanOrgAction("org_test_x", tz()))
      .toEqual({ ok: false, error: m["accounts.createRefusedTestOrgId"] });
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("refuses an unusable timezone before Clerk is touched", async () => {
    expect(await adoptOrphanOrgAction(CLERK_ORG_ID, tz("Mars/Olympus")))
      .toEqual({ ok: false, error: m["accounts.timezoneUnusable"].replace("{zone}", "Mars/Olympus") });
    expect(clerkMocks.getOrg).not.toHaveBeenCalled();
  });
});

describe("the adopt hint tells the truth (review of D-087)", () => {
  it("says invitees sign in once Client access is turned on, not merely once the company is added (mutation: restore \"once it is added\" → FAILS)", () => {
    expect(m["accounts.orphan.adoptHint"]).not.toMatch(/once it is added/i);
    expect(m["accounts.orphan.adoptHint"]).toMatch(/Client access/);
    expect(m["accounts.orphan.adoptHint"]).toMatch(/Settings/);
  });
});

describe("the half-created-company warning (D-087)", () => {
  it("no longer tells the agency to add the company again by name (mutation: restore the old remedy → FAILS)", () => {
    expect(m["accounts.orphan.body"]).not.toMatch(/same name/i);
    expect(m["accounts.orphan.body"]).toContain(m["accounts.orphan.adopt"]);
  });
});
