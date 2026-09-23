import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const dbMocks = {
  updateContact: vi.fn(), deleteContacts: vi.fn(),
  addTagToContacts: vi.fn(), removeTagFromContacts: vi.fn(),
  // …plus whatever contacts/actions.ts already imports from @bis/db —
  // createContact, addTagToContact, etc. — stub them all or the module
  // import throws. Read the file's import list and cover it.
  createContact: vi.fn(),
  setMarketingEmailOptOut: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const {
  updateContactFieldAction, bulkDeleteContactsAction, bulkAddTagAction, bulkRemoveTagAction,
  setMarketingEmailOptOutAction,
} = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateContactFieldAction", () => {
  it("rejects a non-allowlisted field WITHOUT touching the db", async () => {
    const r = await updateContactFieldAction("a1", "c1", "custom" as never, "x");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
  });
  it("maps snake_case field to the ContactInput camel key, empty clears", async () => {
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "company_name", "  ");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateContact).toHaveBeenCalledWith(
      {}, "a1", "c1", { companyName: "" }, "user_1",
    );
  });
});

describe("bulkDeleteContactsAction", () => {
  it("passes through honest counts", async () => {
    dbMocks.deleteContacts.mockResolvedValue({ deleted: 2, skippedBlocked: 1 });
    const r = await bulkDeleteContactsAction("a1", ["x", "y", "z"]);
    expect(r).toEqual({ ok: true, deleted: 2, skippedBlocked: 1 });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.deleteContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkDeleteContactsAction("a1", ["x"]);
    expect(r.ok).toBe(false);
  });
});

describe("bulkAddTagAction", () => {
  it("returns ok:true and spreads the tagId/applied from addTagToContacts", async () => {
    dbMocks.addTagToContacts.mockResolvedValue({ tagId: "t9", applied: 2 });
    const r = await bulkAddTagAction("a1", ["c1", "c2"], "urgent");
    expect(r).toEqual({ ok: true, tagId: "t9", applied: 2 });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.addTagToContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkAddTagAction("a1", ["c1"], "urgent");
    expect(r.ok).toBe(false);
  });
  it("returns ok:false and does not call addTagToContacts when contactIds is empty", async () => {
    const r = await bulkAddTagAction("a1", [], "urgent");
    expect(r.ok).toBe(false);
    expect(dbMocks.addTagToContacts).not.toHaveBeenCalled();
  });
});

describe("bulkRemoveTagAction", () => {
  it("returns ok:true when removeTagFromContacts resolves", async () => {
    dbMocks.removeTagFromContacts.mockResolvedValue(undefined);
    const r = await bulkRemoveTagAction("a1", ["c1", "c2"], "t9");
    expect(r).toEqual({ ok: true });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.removeTagFromContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkRemoveTagAction("a1", ["c1"], "t9");
    expect(r.ok).toBe(false);
  });
});

/**
 * The "No marketing emails" switch's server action. The db function
 * (setMarketingEmailOptOut, packages/db) is what scopes the write to the
 * account and THROWS when no row matched — another account's contact, or one
 * deleted meanwhile — so "refuses another account's contact" here is: that
 * throw becomes a reported failure, and nothing is revalidated as if it saved.
 */
describe("setMarketingEmailOptOutAction", () => {
  it("stamps the opt-out: passes the account, the contact, `true` and the signed-in user to the db", async () => {
    dbMocks.setMarketingEmailOptOut.mockResolvedValue(undefined);
    const r = await setMarketingEmailOptOutAction("a1", "c1", true);
    expect(r).toEqual({ ok: true });
    // The actor is `requireAccountAccess`'s userId (the mock above returns
    // "user_1"): the db function records WHO in the audit event it emits.
    expect(dbMocks.setMarketingEmailOptOut).toHaveBeenCalledWith({}, "a1", "c1", true, "user_1");
  });
  it("clears the opt-out: passes `false` through, not a truthy stand-in", async () => {
    dbMocks.setMarketingEmailOptOut.mockResolvedValue(undefined);
    const r = await setMarketingEmailOptOutAction("a1", "c1", false);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setMarketingEmailOptOut).toHaveBeenCalledWith({}, "a1", "c1", false, "user_1");
  });
  it("revalidates the list (the drawer's rows) and the full contact page after a save", async () => {
    dbMocks.setMarketingEmailOptOut.mockResolvedValue(undefined);
    await setMarketingEmailOptOutAction("a1", "c1", true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });
  it("refuses a contact of another account: the db's no-row throw is ok:false, nothing revalidated", async () => {
    dbMocks.setMarketingEmailOptOut.mockRejectedValue(
      new Error("setMarketingEmailOptOut: no contact c9 on account a1"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await setMarketingEmailOptOutAction("a1", "c9", true);
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    errors.mockRestore();
  });
  it("logs a failed save with the account and contact ids and the db's own message", async () => {
    // The operator sees only "Couldn't save that"; the log is the one trace
    // of WHICH contact on WHICH account refused, and why.
    dbMocks.setMarketingEmailOptOut.mockRejectedValue(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await setMarketingEmailOptOutAction("a1", "c7", false);
    expect(r.ok).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    const line = errors.mock.calls[0]!.map(String).join(" ");
    expect(line).toContain("a1");
    expect(line).toContain("c7");
    expect(line).toContain("db down");
    errors.mockRestore();
  });
  it("rejects a value that is not a real boolean WITHOUT touching the db", async () => {
    // A server action's arguments arrive off the wire; the string "false" is
    // truthy and would STAMP the opt-out if it reached the db as-is.
    const r = await setMarketingEmailOptOutAction("a1", "c1", "false" as never);
    expect(r.ok).toBe(false);
    expect(dbMocks.setMarketingEmailOptOut).not.toHaveBeenCalled();
  });
});
