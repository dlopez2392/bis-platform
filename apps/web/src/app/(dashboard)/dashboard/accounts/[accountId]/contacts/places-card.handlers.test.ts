import { describe, it, expect, vi, beforeEach } from "vitest";

const actions = {
  removePlaceAction: vi.fn(), undoRemovePlaceAction: vi.fn(), setPlaceArchivedAction: vi.fn(), setPlaceOwnerAction: vi.fn(),
  removeEquipmentAction: vi.fn(), undoRemoveEquipmentAction: vi.fn(),
};
vi.mock("./places-actions", () => actions);
const toast = { error: vi.fn(), success: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { placeHandlers } = await import("./places-card-handlers");
const { m } = await import("@/lib/messages");

const C1 = "22222222-2222-4222-8222-222222222222";
const P1 = "11111111-1111-4111-8111-111111111111";
const U1 = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT = { id: P1, account_id: "a1", contact_id: C1, client_group_id: null, label: "Casa" };
const UNIT_SNAPSHOT = { id: U1, account_id: "a1", place_id: P1, name: "AC upstairs" };

/** The Undo the last success toast offered, pressed, and its answer awaited. */
async function pressUndo() {
  const opts = toast.success.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } };
  expect(opts.action.label).toBe(m["common.undo"]);
  opts.action.onClick();
  await new Promise((r) => setTimeout(r, 0));
}
const make = (reload = vi.fn()) => ({ reload, h: placeHandlers({ accountId: "a1", contactId: C1, locale: "en", reload }) });

// reset, not clear: a queued mockResolvedValueOnce one test left unconsumed must not answer the next.
beforeEach(() => vi.resetAllMocks());

describe("placeHandlers: every change runs at once, with Undo (rule 6)", () => {
  it("removing a place offers Undo that restores a deleted place or clears an archive, by the mode the action answered (mutation: always undo as archived -> FAILS)", async () => {
    const { h, reload } = make();
    const deleted = { mode: "deleted", snapshot: SNAPSHOT };
    actions.removePlaceAction.mockResolvedValueOnce({ ok: true, undo: deleted });
    actions.undoRemovePlaceAction.mockResolvedValue({ ok: true });
    await h.removePlace(P1, "Casa");
    expect(actions.removePlaceAction).toHaveBeenCalledWith("a1", C1, P1);
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Removed Casa.");
    expect(reload).toHaveBeenCalledTimes(1);
    await pressUndo();
    expect(actions.undoRemovePlaceAction).toHaveBeenLastCalledWith("a1", C1, deleted);
    expect(actions.setPlaceArchivedAction).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(2);

    const archived = { mode: "archived", placeId: P1 };
    actions.removePlaceAction.mockResolvedValueOnce({ ok: true, undo: archived });
    await h.removePlace(P1, "Casa");
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Moved Casa to Removed properties.");
    await pressUndo();
    expect(actions.undoRemovePlaceAction).toHaveBeenLastCalledWith("a1", C1, archived);
  });

  it("a refused removal says why and offers nothing to undo", async () => {
    const { h, reload } = make();
    actions.removePlaceAction.mockResolvedValueOnce({ ok: false, error: "places.refused" });
    await h.removePlace(P1, "Casa");
    expect(toast.error).toHaveBeenCalledWith(m["places.refused"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("putting a property back offers Undo that removes it again", async () => {
    const { h } = make();
    actions.setPlaceArchivedAction.mockResolvedValue({ ok: true });
    await h.putBack(P1, "Old rental");
    expect(actions.setPlaceArchivedAction).toHaveBeenLastCalledWith("a1", C1, P1, false);
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Put back Old rental.");
    await pressUndo();
    expect(actions.setPlaceArchivedAction).toHaveBeenLastCalledWith("a1", C1, P1, true);
  });

  it("removing a unit offers Undo that restores the snapshot", async () => {
    const { h, reload } = make();
    actions.removeEquipmentAction.mockResolvedValueOnce({ ok: true, snapshot: UNIT_SNAPSHOT });
    actions.undoRemoveEquipmentAction.mockResolvedValueOnce({ ok: true });
    await h.removeUnit(U1, "AC upstairs");
    expect(actions.removeEquipmentAction).toHaveBeenCalledWith("a1", C1, U1);
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Removed AC upstairs.");
    await pressUndo();
    expect(actions.undoRemoveEquipmentAction).toHaveBeenCalledWith("a1", C1, UNIT_SNAPSHOT);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("an added property or unit, and a replacement, offer Undo that deletes the new row", async () => {
    const { h } = make();
    actions.removePlaceAction.mockResolvedValue({ ok: true, undo: { mode: "deleted", snapshot: SNAPSHOT } });
    actions.removeEquipmentAction.mockResolvedValue({ ok: true, snapshot: UNIT_SNAPSHOT });
    h.placeAdded(P1, "Casa");
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Added Casa.");
    await pressUndo();
    expect(actions.removePlaceAction).toHaveBeenLastCalledWith("a1", C1, P1);
    h.unitAdded(U1, "AC upstairs");
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Added AC upstairs.");
    await pressUndo();
    expect(actions.removeEquipmentAction).toHaveBeenLastCalledWith("a1", C1, U1);
    h.unitReplaced(U1);
    expect(toast.success.mock.calls.at(-1)![0]).toBe(m["equipment.replaced"]);
    await pressUndo();
    expect(actions.removeEquipmentAction).toHaveBeenCalledTimes(2);
  });

  it("a failed Undo says Couldn't put it back", async () => {
    const { h } = make();
    actions.removeEquipmentAction.mockResolvedValue({ ok: true, snapshot: UNIT_SNAPSHOT });
    actions.undoRemoveEquipmentAction.mockResolvedValueOnce({ ok: false, error: "places.error.undoFailed" });
    await h.removeUnit(U1, "AC upstairs");
    await pressUndo();
    expect(toast.error).toHaveBeenLastCalledWith(m["places.error.undoFailed"]);
    // A rejected Undo (a stale tab after a redeploy) says the same, never nothing.
    actions.undoRemoveEquipmentAction.mockRejectedValueOnce(new Error("Server Action not found"));
    await h.removeUnit(U1, "AC upstairs");
    await pressUndo();
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenLastCalledWith(m["places.error.undoFailed"]);
  });

  it("speaks the reader's language", async () => {
    const reload = vi.fn();
    const h = placeHandlers({ accountId: "a1", contactId: C1, locale: "es", reload });
    actions.removeEquipmentAction.mockResolvedValueOnce({ ok: true, snapshot: UNIT_SNAPSHOT });
    await h.removeUnit(U1, "Aire de arriba");
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Se quitó Aire de arriba.");
    expect((toast.success.mock.calls.at(-1)![1] as { action: { label: string } }).action.label).toBe(m["common.undo.es"]);
  });

  it("one write at a time per row: a second Remove while the first is in flight does nothing", async () => {
    const { h } = make();
    let resolve!: (v: unknown) => void;
    actions.removeEquipmentAction.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const a = h.removeUnit(U1, "AC upstairs");
    const b = h.removeUnit(U1, "AC upstairs");
    expect(actions.removeEquipmentAction).toHaveBeenCalledTimes(1);
    resolve({ ok: true, snapshot: UNIT_SNAPSHOT });
    await Promise.all([a, b]);
  });
});

describe("placeHandlers: the owner change and a double-clicked Undo (fix round 1)", () => {
  const G1 = "44444444-4444-4444-8444-444444444444";
  it("a new owner says '{place} now belongs to {owner}.' and its Undo sets the prior owner (spec §7; mutation: InlineField's generic toast -> FAILS)", async () => {
    const { h, reload } = make();
    actions.setPlaceOwnerAction.mockResolvedValue({ ok: true });
    h.ownerChanged(P1, "Casa", "Casa Reyes", `contact:${C1}`);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Casa now belongs to Casa Reyes.");
    await pressUndo();
    expect(actions.setPlaceOwnerAction).toHaveBeenCalledTimes(1);
    expect(actions.setPlaceOwnerAction).toHaveBeenLastCalledWith("a1", C1, P1, `contact:${C1}`);
    expect(reload).toHaveBeenCalledTimes(2);
    // In Spanish too.
    const es = placeHandlers({ accountId: "a1", contactId: C1, locale: "es", reload });
    es.ownerChanged(P1, "Casa", "Ana Reyes", `group:${G1}`);
    expect(toast.success.mock.calls.at(-1)![0]).toBe("Casa ahora es de Ana Reyes.");
  });

  it("a double-clicked Undo undoes once (mutation: drop the lock around the Undo -> FAILS)", async () => {
    const { h } = make();
    actions.removeEquipmentAction.mockResolvedValueOnce({ ok: true, snapshot: UNIT_SNAPSHOT });
    let resolve!: (v: unknown) => void;
    actions.undoRemoveEquipmentAction.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await h.removeUnit(U1, "AC upstairs");
    const opts = toast.success.mock.calls.at(-1)![1] as { action: { onClick: () => void } };
    opts.action.onClick();
    opts.action.onClick();
    expect(actions.undoRemoveEquipmentAction).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
