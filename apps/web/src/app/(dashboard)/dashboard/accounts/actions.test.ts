import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The first test file for the agency's account-creation action. It covers the
 * function's three exits — an unusable timezone (refused before Clerk is
 * touched), a test-shaped org id (refused after Clerk, with the organisation
 * rolled back), and the happy path — because the one that matters most, the
 * refusal, is only meaningful if the other two are pinned beside it.
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
const clerkMocks = vi.hoisted(() => ({ createOrg: vi.fn(), deleteOrg: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      createOrganization: clerkMocks.createOrg,
      deleteOrganization: clerkMocks.deleteOrg,
    },
  }),
}));

import { redirect } from "next/navigation";
import { NO_BLUEPRINT_SENTINEL } from "./constants";
import { createClientAccount } from "./actions";

/** What a real Clerk organisation id looks like: `org_` plus base58. */
const CLERK_ORG_ID = "org_2abcDEFghiJKL";

const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("name", "Rio Roofing");
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
});

describe("createClientAccount", () => {
  it("creates the account under the id Clerk minted", async () => {
    await createClientAccount(form());

    expect(dbMocks.createAccount).toHaveBeenCalledTimes(1);
    expect(dbMocks.createAccount.mock.calls[0]?.[1]).toMatchObject({ clerkOrgId: CLERK_ORG_ID });
    expect(clerkMocks.deleteOrg).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/dashboard/accounts/acct_1/setup");
  });

  it("refuses a test-shaped org id and takes the Clerk organisation with it", async () => {
    // The fixture sweep deletes any account whose clerk_org_id starts with
    // `org_test_` once it is an hour old (packages/db/src/test/sweep-fixtures.ts).
    // If production could ever mint one, a real business's account would
    // disappear overnight — so this is refused at the door, and the Clerk
    // organisation is rolled back so nothing is left half-made.
    clerkMocks.createOrg.mockResolvedValue({ id: "org_test_evil" });

    await expect(createClientAccount(form())).rejects.toThrow(
      "We could not create this account. The new organization came back with an id " +
      "we reserve for test data, and accounts with that kind of id are deleted " +
      "automatically an hour later. Nothing was saved. Please try again, and tell " +
      "the BIS team if it happens twice.",
    );

    expect(dbMocks.createAccount).not.toHaveBeenCalled();
    expect(clerkMocks.deleteOrg).toHaveBeenCalledTimes(1);
    expect(clerkMocks.deleteOrg).toHaveBeenCalledWith("org_test_evil");
  });

  it("refuses an unusable timezone before it makes a Clerk organisation", async () => {
    await expect(createClientAccount(form({ timezone: "Mars/Olympus" }))).rejects.toThrow();

    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });
});
