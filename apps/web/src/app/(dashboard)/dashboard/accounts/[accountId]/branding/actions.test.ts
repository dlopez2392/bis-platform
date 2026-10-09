import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({
  setBranding: vi.fn(),
  getBranding: vi.fn(),
  uploadBrandLogo: vi.fn(),
  removeBrandLogo: vi.fn(),
  sweepOrphanedLogos: vi.fn(),
  restoreBrandLogoIfCleared: vi.fn(),
  logoExists: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
// A real vi.fn() (not a bare async arrow) so a test can assert the auth
// check actually ran — a mutation that deletes the `requireAccountAccess`
// call in an action would otherwise still pass every other assertion here.
const authMocks = vi.hoisted(() => ({
  requireAccountAccess: vi.fn(async () => ({ userId: "user_1", isAgency: true })),
}));
vi.mock("@/lib/auth", () => authMocks);
// setBrandingAction writes through the RLS-enforced client, not serviceDb() —
// see the action's own doc comment. A real client is unnecessary here since
// dbForRequest's result only ever flows straight into the (mocked)
// setBranding call.
const dbForRequestInstance = { tag: "dbForRequest" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => dbForRequestInstance }));
// D-005: the Clerk organisation name follows the brand name. The helper owns
// the read and the Clerk call and never throws (clerk-org-name.test.ts); here
// only WHEN and WITH WHAT the action calls it.
const orgNameMocks = vi.hoisted(() => ({ syncClerkOrgName: vi.fn(async () => true) }));
vi.mock("@/lib/accounts/clerk-org-name", () => orgNameMocks);
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({}) }));

import { m } from "@/lib/messages";
import { setBrandingAction, removeBrandLogoAction, restoreBrandLogoAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  dbMocks.setBranding.mockReset().mockResolvedValue(undefined);
  dbMocks.getBranding.mockReset();
  dbMocks.uploadBrandLogo.mockReset();
  dbMocks.removeBrandLogo.mockReset();
  dbMocks.sweepOrphanedLogos.mockReset().mockResolvedValue(undefined);
  dbMocks.restoreBrandLogoIfCleared.mockReset().mockResolvedValue(true);
  dbMocks.logoExists.mockReset().mockResolvedValue(true);
  authMocks.requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1", isAgency: true });
  orgNameMocks.syncClerkOrgName.mockReset().mockResolvedValue(true);
});

describe("setBrandingAction — the Clerk organisation follows the brand name (D-005)", () => {
  it("after a successful save, renames this account's Clerk organisation to the trimmed brand name, so invitation emails name the company as it is now (mutation: drop the sync → FAILS)", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "  Rio Roofing  " }))).toEqual({ ok: true });
    expect(orgNameMocks.syncClerkOrgName).toHaveBeenCalledOnce();
    const [db, , accountId, name] = orgNameMocks.syncClerkOrgName.mock.calls[0]! as unknown as [unknown, unknown, string, string];
    expect(db).toBe(dbForRequestInstance);
    expect(accountId).toBe("acct_1");
    expect(name).toBe("Rio Roofing");
  });

  it("a failed save never renames the organisation (mutation: sync before the write → FAILS)", async () => {
    dbMocks.setBranding.mockRejectedValue(new Error("rls"));
    expect(await setBrandingAction("acct_1", fd({ brandName: "Rio Roofing" })))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
    expect(orgNameMocks.syncClerkOrgName).not.toHaveBeenCalled();
  });

  it("a sync that could not reach Clerk still reports the save, which did happen (fail soft)", async () => {
    orgNameMocks.syncClerkOrgName.mockResolvedValue(false);
    expect(await setBrandingAction("acct_1", fd({ brandName: "Rio Roofing" }))).toEqual({ ok: true });
  });
});

describe("setBrandingAction — brand name is required", () => {
  it("refuses a blank brandName without writing", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "" })))
      .toEqual({ ok: false, error: m["branding.nameRequired"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only brandName without writing", async () => {
    // Mutation: delete the `if (!brandName) return …` guard in the action —
    // a whitespace name then saves as "" instead of being refused. (Restoring
    // the old `|| null` alone is NOT a mutation that bites: null is falsy, so
    // the guard still refuses it.)
    expect(await setBrandingAction("acct_1", fd({ brandName: "   " })))
      .toEqual({ ok: false, error: m["branding.nameRequired"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("saves a normal, trimmed name", async () => {
    expect(await setBrandingAction("acct_1", fd({ brandName: "  Acme Dental  " })))
      .toEqual({ ok: true });
    expect(dbMocks.setBranding).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1",
      {
        brandName: "Acme Dental", brandColor: null, brandNeutral: null,
        brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
        mailingAddress: null,
      },
      "user_1",
    );
  });
});

/**
 * The postal address the reactivation email prints (migration 0048). The
 * database CHECK refuses a value that is blank once EXACTLY `.trim()`'s set is
 * stripped, and caps it at 300 code points; the action has to be at least that
 * strict, never looser, or a save reaches Postgres and comes back as the
 * generic "Could not update branding" instead of a message anyone can act on.
 */
describe("setBrandingAction — mailing address", () => {
  /** What setBranding received as its input object, for the one call made. */
  const sent = () => dbMocks.setBranding.mock.calls[0]![2] as Record<string, unknown>;

  it("saves the address trimmed, keeping the line breaks inside it", async () => {
    // Mutation: drop the `.trim()` on the raw address → FAILS (the padding and
    // the trailing newline reach setBranding).
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: "  \n123 Main St\nMcAllen, TX 78501 \n ",
    }))).toEqual({ ok: true });
    expect(sent().mailingAddress).toBe("123 Main St\nMcAllen, TX 78501");
  });

  it("clears it (null, never \"\") when the box is emptied", async () => {
    // Mutation: pass the trimmed string through instead of `=== "" ? null` →
    // FAILS with "" (a second spelling of "not set", which the column refuses).
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: "" })))
      .toEqual({ ok: true });
    expect(sent().mailingAddress).toBeNull();
  });

  it("clears it when the box holds only whitespace — every kind .trim() strips", async () => {
    // Tab, line breaks, a no-break space, a byte-order mark and an
    // ideographic space — written as `\u` escapes so the line is reviewable:
    // blank to the send path's `.trim()` and to the column's CHECK, so this
    // must arrive as null and never be sent to the database as text.
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: " \t\r\n\u00A0\uFEFF\u3000 ",
    }))).toEqual({ ok: true });
    expect(sent().mailingAddress).toBeNull();
  });

  it("refuses 301 characters with its own message, without writing", async () => {
    // Mutation: delete the length check → FAILS (the action writes it).
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: "a".repeat(301) })))
      .toEqual({ ok: false, error: m["branding.mailingAddressTooLong"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("accepts exactly 300, and counts the length AFTER trimming", async () => {
    // Mutation: `>= 300` → FAILS on the first call; checking the raw length
    // before trimming → FAILS on the second (302 raw, 300 once trimmed).
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: "a".repeat(300) })))
      .toEqual({ ok: true });
    expect(await setBrandingAction("acct_1", fd({ brandName: "Acme Dental", mailingAddress: ` ${"a".repeat(300)}\n` })))
      .toEqual({ ok: true });
    expect(dbMocks.setBranding).toHaveBeenCalledTimes(2);
    expect(dbMocks.setBranding.mock.calls[1]![2]).toMatchObject({ mailingAddress: "a".repeat(300) });
  });

  it("normalizes CRLF (and lone CR) line breaks to LF before storing", async () => {
    // An HTML form submission normalizes a textarea's line breaks to CRLF
    // regardless of what the user actually typed (browsers do this on
    // submit, not on keystroke) — CI's e2e run caught this: the browser sent
    // "PO Box 12\r\nEdinburg, TX 78539" and the column held the \r\n verbatim.
    // Mutation: delete the normalization → FAILS (the \r survives to
    // setBranding untouched).
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: "PO Box 12\r\nEdinburg, TX 78539",
    }))).toEqual({ ok: true });
    expect(sent().mailingAddress).toBe("PO Box 12\nEdinburg, TX 78539");

    // A lone \r (old Mac-style) is normalized too, not just \r\n pairs.
    expect(await setBrandingAction("acct_1", fd({
      brandName: "Acme Dental", mailingAddress: "PO Box 12\rEdinburg, TX 78539",
    }))).toEqual({ ok: true });
    expect(dbMocks.setBranding.mock.calls[1]![2]).toMatchObject({
      mailingAddress: "PO Box 12\nEdinburg, TX 78539",
    });
  });

  it("rides the write that also carries a new logo", async () => {
    // The action has TWO setBranding call sites (with and without a new logo
    // path). Mutation: drop mailingAddress from the logo branch's object →
    // FAILS here and nowhere else.
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: null });
    dbMocks.uploadBrandLogo.mockResolvedValue("acct_1/logo.png");
    const f = fd({ brandName: "Acme Dental", mailingAddress: "PO Box 12, Edinburg, TX 78539" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    f.set("logo", new File([png], "logo.png", { type: "image/png" }));
    expect(await setBrandingAction("acct_1", f)).toEqual({ ok: true });
    expect(sent()).toMatchObject({
      brandLogoPath: "acct_1/logo.png", mailingAddress: "PO Box 12, Edinburg, TX 78539",
    });
  });
});

describe("setBrandingAction — sweeping stale logo objects after a successful upload", () => {
  it("sweeps the account's whole logo prefix, keeping only the freshly-uploaded path", async () => {
    // Replaces the old single-file removeBrandLogo(previousLogoPath) call:
    // the sweep also cleans up anything an earlier, un-undone Remove left
    // behind. Mutation: call removeBrandLogo(previousLogoPath) instead of
    // sweepOrphanedLogos(accountId, brandLogoPath) → FAILS (wrong function,
    // wrong args).
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo-old.png" });
    dbMocks.uploadBrandLogo.mockResolvedValue("acct_1/logo-new.png");
    const f = fd({ brandName: "Acme Dental" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    f.set("logo", new File([png], "logo.png", { type: "image/png" }));
    expect(await setBrandingAction("acct_1", f)).toEqual({ ok: true });
    expect(dbMocks.sweepOrphanedLogos).toHaveBeenCalledWith({}, "acct_1", "acct_1/logo-new.png");
    expect(dbMocks.removeBrandLogo).not.toHaveBeenCalled();
  });

  it("sweeps with keep = the SAME path when the upload is byte-identical (content-addressed, nothing to orphan)", async () => {
    // Mutation: title/intent check — sweepOrphanedLogos IS still called here
    // (it is the one place that re-reads the live column and decides what
    // survives); what must NOT happen is a second, different removeBrandLogo
    // call. Mutation: call removeBrandLogo as well → FAILS.
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo-same.png" });
    dbMocks.uploadBrandLogo.mockResolvedValue("acct_1/logo-same.png");
    const f = fd({ brandName: "Acme Dental" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    f.set("logo", new File([png], "logo.png", { type: "image/png" }));
    expect(await setBrandingAction("acct_1", f)).toEqual({ ok: true });
    expect(dbMocks.sweepOrphanedLogos).toHaveBeenCalledWith({}, "acct_1", "acct_1/logo-same.png");
    expect(dbMocks.removeBrandLogo).not.toHaveBeenCalled();
  });
});

describe("removeBrandLogoAction", () => {
  it("checks account access before doing anything (mutation: delete the requireAccountAccess call → FAILS)", async () => {
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo.png" });
    await removeBrandLogoAction("acct_1");
    expect(authMocks.requireAccountAccess).toHaveBeenCalledWith("acct_1");
  });

  it("reads the current path through the RLS-enforced client, not serviceDb() (house rule) (mutation: getBranding(serviceDb()) → FAILS, {} is not dbForRequestInstance)", async () => {
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo.png" });
    await removeBrandLogoAction("acct_1");
    expect(dbMocks.getBranding).toHaveBeenCalledWith(dbForRequestInstance, "acct_1");
  });

  it("clears brand_logo_path to null through setBranding, WITHOUT deleting the stored object, and returns the cleared path", async () => {
    // Mutation: pass the path instead of null → FAILS (undo would have
    // nothing to restore FROM, since the column already holds it).
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo-abc.png" });
    expect(await removeBrandLogoAction("acct_1")).toEqual({ ok: true, path: "acct_1/logo-abc.png" });
    expect(dbMocks.setBranding).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1", { brandLogoPath: null }, "user_1",
    );
    expect(dbMocks.removeBrandLogo).not.toHaveBeenCalled();
  });

  it("sweeps other stale objects in the account's folder, but keeps the one it just cleared (so Undo still works)", async () => {
    // Mutation: call sweepOrphanedLogos with `null` instead of the cleared
    // path → FAILS (the kept-for-undo object would be swept too).
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo-abc.png" });
    await removeBrandLogoAction("acct_1");
    expect(dbMocks.sweepOrphanedLogos).toHaveBeenCalledWith({}, "acct_1", "acct_1/logo-abc.png");
  });

  it("sweeps ONLY after the write succeeds, never before (near-Critical review fix: a failed write must delete nothing) (mutation: reorder sweep before setBranding → FAILS, call order below is checked)", async () => {
    const order: string[] = [];
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo-abc.png" });
    dbMocks.setBranding.mockImplementation(async () => { order.push("write"); });
    dbMocks.sweepOrphanedLogos.mockImplementation(async () => { order.push("sweep"); });
    await removeBrandLogoAction("acct_1");
    expect(order).toEqual(["write", "sweep"]);
  });

  it("sweeps nothing when the write throws (mutation: run the sweep unconditionally, outside the write's try/catch → FAILS)", async () => {
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo-abc.png" });
    dbMocks.setBranding.mockRejectedValue(new Error("boom"));
    expect(await removeBrandLogoAction("acct_1")).toEqual({ ok: false, error: m["branding.saveFailed"] });
    expect(dbMocks.sweepOrphanedLogos).not.toHaveBeenCalled();
  });

  it("refuses with a plain-language error when there is no logo to remove, and writes nothing", async () => {
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: null });
    expect(await removeBrandLogoAction("acct_1")).toEqual({ ok: false, error: m["branding.noLogoToRemove"] });
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
  });

  it("answers the generic save-failed message, in plain language, when the write throws", async () => {
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo.png" });
    dbMocks.setBranding.mockRejectedValue(new Error("boom"));
    expect(await removeBrandLogoAction("acct_1")).toEqual({ ok: false, error: m["branding.saveFailed"] });
  });

  it("never lets a client clear another account's logo (RLS write client, not serviceDb)", async () => {
    // setBranding here is called with dbForRequestInstance (the RLS-enforced
    // client bound to the signed-in user), exactly like setBrandingAction —
    // never serviceDb(), which would bypass the per-account write policy.
    // Mutation: swap in serviceDb() for the write → FAILS (wrong client
    // object reaches setBranding).
    dbMocks.getBranding.mockResolvedValue({ brandLogoPath: "acct_1/logo.png" });
    await removeBrandLogoAction("acct_1");
    expect(dbMocks.setBranding.mock.calls[0]![0]).toBe(dbForRequestInstance);
  });
});

describe("restoreBrandLogoAction — the Undo of removeBrandLogoAction", () => {
  it("checks account access before doing anything (mutation: delete the requireAccountAccess call → FAILS)", async () => {
    await restoreBrandLogoAction("acct_1", "acct_1/logo-0123456789abcdef.png");
    expect(authMocks.requireAccountAccess).toHaveBeenCalledWith("acct_1");
  });

  it("checks Storage existence and the database compare-and-set, never setBranding directly, and never re-uploads", async () => {
    expect(await restoreBrandLogoAction("acct_1", "acct_1/logo-0123456789abcdef.png")).toEqual({ ok: true });
    expect(dbMocks.logoExists).toHaveBeenCalledWith({}, "acct_1/logo-0123456789abcdef.png");
    expect(dbMocks.restoreBrandLogoIfCleared).toHaveBeenCalledWith(
      dbForRequestInstance, "acct_1", "acct_1/logo-0123456789abcdef.png", "user_1",
    );
    expect(dbMocks.setBranding).not.toHaveBeenCalled();
    expect(dbMocks.uploadBrandLogo).not.toHaveBeenCalled();
  });

  // I1 (near-Critical, 2026-10-04): Remove → a fresh upload sets a NEW path
  // → a stale Undo toast for the OLD path must lose, not overwrite the new
  // logo. restoreBrandLogoIfCleared's compare-and-set is what actually
  // refuses this (false = "column was not null"); here it's wired to a
  // plain-language refusal, not a silent `ok: true`.
  it("refuses, in plain language, when the compare-and-set reports the column was no longer null (Remove → upload → stale Undo)", async () => {
    dbMocks.restoreBrandLogoIfCleared.mockResolvedValue(false);
    expect(await restoreBrandLogoAction("acct_1", "acct_1/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.logoGone"] });
  });

  // I1 (near-Critical, 2026-10-04): Remove → upload → Remove → stale Undo
  // for the FIRST Remove's path, which the second upload's sweep already
  // deleted. Mutation: skip the exists() check and go straight to the CAS →
  // FAILS (the CAS alone would succeed here, since the column IS null).
  it("refuses, in plain language, when the object no longer exists in Storage (Remove → upload → Remove → stale Undo for the first path)", async () => {
    dbMocks.logoExists.mockResolvedValue(false);
    expect(await restoreBrandLogoAction("acct_1", "acct_1/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.logoGone"] });
    expect(dbMocks.restoreBrandLogoIfCleared).not.toHaveBeenCalled();
  });

  // I2 (near-Critical, 2026-10-04): a bare `startsWith` prefix check passed
  // `acct_1/../acct_2/logo-abc.png`, which a URL normalizes to the OTHER
  // account's object. The exact-shape regex refuses it outright.
  it("refuses a path that escapes the account's own folder via '..' , without writing (mutation: drop the exact-shape check for a bare startsWith → FAILS)", async () => {
    expect(await restoreBrandLogoAction("acct_1", "acct_1/../acct_2/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
    expect(dbMocks.logoExists).not.toHaveBeenCalled();
    expect(dbMocks.restoreBrandLogoIfCleared).not.toHaveBeenCalled();
  });

  it("refuses a path with anything before the account's folder (mutation: drop the regex's leading ^ → FAILS)", async () => {
    expect(await restoreBrandLogoAction("acct_1", "x/acct_1/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
    expect(dbMocks.logoExists).not.toHaveBeenCalled();
    expect(dbMocks.restoreBrandLogoIfCleared).not.toHaveBeenCalled();
  });

  it("refuses a path in the right folder but the wrong shape — not one of uploadBrandLogo's own names (mutation: drop the filename regex → FAILS)", async () => {
    expect(await restoreBrandLogoAction("acct_1", "acct_1/not-a-logo.png"))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
    expect(dbMocks.logoExists).not.toHaveBeenCalled();
  });

  it("refuses a path outside the account's own folder, without writing (mutation: drop the prefix check → FAILS)", async () => {
    expect(await restoreBrandLogoAction("acct_1", "acct_2/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
    expect(dbMocks.restoreBrandLogoIfCleared).not.toHaveBeenCalled();
  });

  it("answers the generic save-failed message when the compare-and-set throws", async () => {
    dbMocks.restoreBrandLogoIfCleared.mockRejectedValue(new Error("boom"));
    expect(await restoreBrandLogoAction("acct_1", "acct_1/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
  });

  it("answers the generic save-failed message when the Storage existence check throws", async () => {
    dbMocks.logoExists.mockRejectedValue(new Error("boom"));
    expect(await restoreBrandLogoAction("acct_1", "acct_1/logo-0123456789abcdef.png"))
      .toEqual({ ok: false, error: m["branding.saveFailed"] });
  });
});
