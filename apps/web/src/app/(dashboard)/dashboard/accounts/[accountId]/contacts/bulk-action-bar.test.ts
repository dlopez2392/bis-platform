import { describe, it, expect, vi, beforeEach } from "vitest";

const bulkAddTagAction = vi.fn();
const bulkRemoveTagAction = vi.fn();
const bulkDeleteContactsAction = vi.fn();
vi.mock("./actions", () => ({ bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction }));

const { applyBulkTag } = await import("./bulk-action-bar");

beforeEach(() => {
  bulkAddTagAction.mockReset();
  bulkRemoveTagAction.mockReset();
});

// D-007: Undo after a bulk tag must remove the tag only from contacts that
// did NOT already carry it before the bulk-tag ran — never the whole
// original selection, which would strip the tag from a contact that already
// had it.
describe("applyBulkTag's undo (D-007)", () => {
  it("wires Undo to remove the tag ONLY from the newly-tagged ids (addedIds), not the full original selection", async () => {
    bulkAddTagAction.mockResolvedValue({ ok: true, tagId: "t9", applied: 3, addedIds: ["c2", "c3"] });
    bulkRemoveTagAction.mockResolvedValue({ ok: true });

    const r = await applyBulkTag("a1", ["c1", "c2", "c3"], "vip");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.applied).toBe(3);

    await r.undo();
    expect(bulkRemoveTagAction).toHaveBeenCalledWith("a1", ["c2", "c3"], "t9");
    expect(bulkRemoveTagAction).not.toHaveBeenCalledWith("a1", ["c1", "c2", "c3"], "t9");
  });

  it("propagates a failed add without calling remove at all", async () => {
    bulkAddTagAction.mockResolvedValue({ ok: false, error: "nope" });
    const r = await applyBulkTag("a1", ["c1"], "vip");
    expect(r).toEqual({ ok: false, error: "nope" });
    expect(bulkRemoveTagAction).not.toHaveBeenCalled();
  });
});
