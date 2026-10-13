import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Details' writes (S-03 part 2, plan Task 6, review round 1 finding 1): extracted from
 * details-card.tsx so the save/Undo wiring has a behavioural test independent of the component
 * tree — a component-level test alone let a bug through where the Undo resent the CLIENT's current
 * value instead of the SERVER's previous one, and every card test still passed.
 */
vi.mock("../../contacts/groups-actions", () => ({
  renameGroupAction: vi.fn(),
  setBillingAddressAction: vi.fn(),
}));

const { detailsHandlers } = await import("./details-handlers");
const actions = await import("../../contacts/groups-actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detailsHandlers.nameSave", () => {
  it("refuses an empty value locally with groups.nameEmpty and makes NO server call (mutation: let an empty value through to renameGroupAction -> FAILS)", async () => {
    const onChanged = vi.fn();
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    expect(await h.nameSave("")).toEqual({ ok: false, error: "A group needs a name." });
    expect(actions.renameGroupAction).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("refuses an empty value in the reader's language (mutation: always answer the English string -> FAILS)", async () => {
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "es", onChanged: vi.fn() });
    expect(await h.nameSave("")).toEqual({ ok: false, error: "Un grupo necesita un nombre." });
  });

  it("a non-empty value writes through renameGroupAction and hands back the SERVER's previous as the undo payload (mutation: hand back the value just saved instead of r.previous -> FAILS)", async () => {
    vi.mocked(actions.renameGroupAction).mockResolvedValue({ ok: true, previous: "Old Name" });
    const onChanged = vi.fn();
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    const r = await h.nameSave("New Name");
    expect(actions.renameGroupAction).toHaveBeenCalledWith("a1", "g1", "New Name");
    expect(r).toEqual({ ok: true, undoPayload: "Old Name" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("maps a server refusal through the catalogue, and a rejected call to the generic failed text (mutation: swallow {ok:false} and return {ok:true} -> FAILS)", async () => {
    vi.mocked(actions.renameGroupAction).mockResolvedValueOnce({ ok: false, error: "groups.nameTaken" });
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged: vi.fn() });
    expect(await h.nameSave("Taken Co")).toEqual({ ok: false, error: "There's already a business customer with that name." });
    vi.mocked(actions.renameGroupAction).mockRejectedValueOnce(new Error("stale"));
    expect(await h.nameSave("X")).toEqual({ ok: false, error: "That didn't save. Try again." });
  });
});

describe("detailsHandlers.nameUndo", () => {
  it("calls renameGroupAction with EXACTLY its own argument — the server's previous value — never a value saved earlier in this session (mutation: Undo resends the value just saved instead of its own argument -> FAILS)", async () => {
    const onChanged = vi.fn();
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    // A save happens first, as it would in the UI, to prove the Undo does not remember or resend it.
    vi.mocked(actions.renameGroupAction).mockResolvedValueOnce({ ok: true, previous: "Old Name" });
    await h.nameSave("New Name");
    vi.mocked(actions.renameGroupAction).mockResolvedValueOnce({ ok: true, previous: "irrelevant" });
    const r = await h.nameUndo("Old Name");
    expect(actions.renameGroupAction).toHaveBeenLastCalledWith("a1", "g1", "Old Name");
    expect(r).toEqual({ ok: true });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("reports a refusal through the catalogue rather than throwing (mutation: drop the !r.ok check -> FAILS)", async () => {
    vi.mocked(actions.renameGroupAction).mockResolvedValue({ ok: false, error: "groups.refused" });
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "es", onChanged: vi.fn() });
    expect(await h.nameUndo("Old Name")).toEqual({ ok: false, error: "No puede cambiar ese grupo." });
  });
});

describe("detailsHandlers.addressSave", () => {
  it("clears an empty value to null, and passes a non-empty value through unchanged (mutation: pass \"\" straight through instead of null -> FAILS)", async () => {
    vi.mocked(actions.setBillingAddressAction).mockResolvedValue({ ok: true, previous: null });
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged: vi.fn() });
    await h.addressSave("");
    expect(actions.setBillingAddressAction).toHaveBeenCalledWith("a1", "g1", null);
    await h.addressSave("123 Elm St");
    expect(actions.setBillingAddressAction).toHaveBeenLastCalledWith("a1", "g1", "123 Elm St");
  });
});

describe("detailsHandlers.addressUndo", () => {
  it("calls setBillingAddressAction with EXACTLY its own argument — the server's previous value — never a value saved earlier in this session (mutation: Undo resends the value just saved instead of its own argument -> FAILS)", async () => {
    const onChanged = vi.fn();
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    vi.mocked(actions.setBillingAddressAction).mockResolvedValueOnce({ ok: true, previous: "Old Address" });
    await h.addressSave("New Address");
    vi.mocked(actions.setBillingAddressAction).mockResolvedValueOnce({ ok: true, previous: "irrelevant" });
    const r = await h.addressUndo("Old Address");
    expect(actions.setBillingAddressAction).toHaveBeenLastCalledWith("a1", "g1", "Old Address");
    expect(r).toEqual({ ok: true });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("clearing back to null through Undo sends null, not the empty string (mutation: send '' instead of the null argument -> FAILS)", async () => {
    vi.mocked(actions.setBillingAddressAction).mockResolvedValue({ ok: true, previous: null });
    const h = detailsHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged: vi.fn() });
    await h.addressUndo(null);
    expect(actions.setBillingAddressAction).toHaveBeenCalledWith("a1", "g1", null);
  });
});
