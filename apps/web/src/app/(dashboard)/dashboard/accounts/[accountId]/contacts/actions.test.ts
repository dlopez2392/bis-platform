import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = {
  updateContact: vi.fn(), deleteContacts: vi.fn(),
  addTagToContacts: vi.fn(), removeTagFromContacts: vi.fn(),
  // …plus whatever contacts/actions.ts already imports from @bis/db —
  // createContact, addTagToContact, etc. — stub them all or the module
  // import throws. Read the file's import list and cover it.
  createContact: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const { updateContactFieldAction, bulkDeleteContactsAction, bulkAddTagAction, bulkRemoveTagAction } = await import("./actions");

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
