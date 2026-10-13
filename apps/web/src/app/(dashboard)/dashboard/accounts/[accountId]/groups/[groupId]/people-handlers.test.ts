import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * People's writes (S-03 part 2, plan Task 6). Mocks the Groups card's own actions (plan deviation 5
 * reuses them) and sonner, the groups-card.test.ts:7-15 shape, with setGroupPrimaryContactAction added.
 */
vi.mock("../../contacts/groups-actions", () => ({
  setGroupPrimaryContactAction: vi.fn(),
  removeMembershipAction: vi.fn(),
  restoreMembershipAction: vi.fn(),
  setBillingAction: vi.fn(),
  setRoleAction: vi.fn(),
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { peopleHandlers, groupErrorText } = await import("./people-handlers");
const actions = await import("../../contacts/groups-actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("groupErrorText", () => {
  it("maps a known key to its catalogue text in the given locale, and an unrecognized error falls back to groups.failed (mutation: drop 'groups.nameTaken' from ERROR_KEYS -> FAILS)", () => {
    expect(groupErrorText("groups.refused", "es")).toBe("No puede cambiar ese grupo.");
    expect(groupErrorText("groups.nameTaken", "en")).toBe("There's already a business customer with that name.");
    expect(groupErrorText("some-unexpected-error", "en")).toBe("That didn't save. Try again.");
  });
});

describe("peopleHandlers.makePrimaryContact", () => {
  it("toast names the person in the reader's language, and its Undo sends the server's previous back (spec §5; mutation: Undo with null always -> FAILS)", async () => {
    vi.mocked(actions.setGroupPrimaryContactAction).mockResolvedValue({ ok: true, previous: "m0" });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "es", onChanged });
    expect(await h.makePrimaryContact({ memberId: "m1", name: "Ana García" })).toBe(true);
    expect(actions.setGroupPrimaryContactAction).toHaveBeenCalledWith("a1", "g1", "m1");
    const [text, opts] = toast.success.mock.calls[0]!;
    expect(text).toBe("Ana García ahora es el contacto principal.");
    await (opts as { action: { onClick: () => void } }).action.onClick();
    expect(actions.setGroupPrimaryContactAction).toHaveBeenLastCalledWith("a1", "g1", "m0");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("a first choice's Undo clears (previous null) (mutation: hardcode the Undo's member id instead of r.previous -> FAILS)", async () => {
    vi.mocked(actions.setGroupPrimaryContactAction).mockResolvedValue({ ok: true, previous: null });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    expect(await h.makePrimaryContact({ memberId: "m1", name: "Ana García" })).toBe(true);
    const [, opts] = toast.success.mock.calls[0]!;
    await (opts as { action: { onClick: () => void } }).action.onClick();
    expect(actions.setGroupPrimaryContactAction).toHaveBeenLastCalledWith("a1", "g1", null);
  });

  it("an Undo whose previous has gone shows 'That didn't save. Try again.' (groups.failed) (mutation: skip the !r.ok check in runUndo -> FAILS)", async () => {
    vi.mocked(actions.setGroupPrimaryContactAction)
      .mockResolvedValueOnce({ ok: true, previous: "m0" })
      .mockResolvedValueOnce({ ok: false, error: "groups.failed" });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    await h.makePrimaryContact({ memberId: "m1", name: "Ana" });
    const [, opts] = toast.success.mock.calls[0]!;
    await (opts as { action: { onClick: () => void } }).action.onClick();
    expect(toast.error).toHaveBeenCalledWith("That didn't save. Try again.");
    // onChanged only fires for the original write, never for the failed Undo.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a rejected action (a stale tab) is a toast, never a throw (mutation: remove the try/catch around run() -> FAILS)", async () => {
    vi.mocked(actions.setGroupPrimaryContactAction).mockRejectedValue(new Error("stale"));
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "es", onChanged });
    await expect(h.makePrimaryContact({ memberId: "m1", name: "Ana" })).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith("No se guardó. Intente de nuevo.");
  });
});

describe("peopleHandlers.remove", () => {
  it("'Removed {name} from this group.' with an Undo that restores the server's own snapshot (mutation: Undo sends member.memberId instead of r.removed -> FAILS)", async () => {
    const SNAP = { id: "m1", account_id: "a1", client_group_id: "g1", contact_id: "c1" };
    vi.mocked(actions.removeMembershipAction).mockResolvedValue({ ok: true, removed: SNAP as never });
    vi.mocked(actions.restoreMembershipAction).mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    expect(await h.remove({ memberId: "m1", name: "Ana" })).toBe(true);
    expect(actions.removeMembershipAction).toHaveBeenCalledWith("a1", "m1");
    const [text, opts] = toast.success.mock.calls[0]!;
    expect(text).toBe("Removed Ana from this group.");
    await (opts as { action: { onClick: () => void } }).action.onClick();
    expect(actions.restoreMembershipAction).toHaveBeenCalledWith("a1", SNAP);
  });
});

describe("peopleHandlers.toggleBilling", () => {
  it("a boolean toggle via setBillingAction, saved with an Undo back to the server's previous value (mutation: Undo resends the SAME isBilling instead of r.previous -> FAILS)", async () => {
    vi.mocked(actions.setBillingAction).mockResolvedValue({ ok: true, previous: false });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    expect(await h.toggleBilling({ memberId: "m1", isBilling: false })).toBe(true);
    expect(actions.setBillingAction).toHaveBeenCalledWith("a1", "m1", true);
    const [text, opts] = toast.success.mock.calls[0]!;
    expect(text).toBe("Saved.");
    await (opts as { action: { onClick: () => void } }).action.onClick();
    expect(actions.setBillingAction).toHaveBeenLastCalledWith("a1", "m1", false);
  });
});

describe("peopleHandlers.roleSave / roleUndo", () => {
  it("roleSave clears an empty value to null and hands back the server's previous role as the undo payload (mutation: pass '' straight through instead of null -> FAILS)", async () => {
    vi.mocked(actions.setRoleAction).mockResolvedValue({ ok: true, previous: "Madre" });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    const r = await h.roleSave("m1")("");
    expect(actions.setRoleAction).toHaveBeenCalledWith("a1", "m1", null);
    expect(r).toEqual({ ok: true, undoPayload: "Madre" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("roleUndo writes the prior value back and reports the catalogue error on refusal, in the reader's language (mutation: return {ok:true} on refusal -> FAILS)", async () => {
    vi.mocked(actions.setRoleAction).mockResolvedValue({ ok: false, error: "groups.refused" });
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "es", onChanged });
    const r = await h.roleUndo("m1")("Dueño");
    expect(actions.setRoleAction).toHaveBeenCalledWith("a1", "m1", "Dueño");
    expect(r).toEqual({ ok: false, error: "No puede cambiar ese grupo." });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("roleSave reports a crash as the catalogue's failed text rather than throwing (mutation: let the rejection propagate -> FAILS)", async () => {
    vi.mocked(actions.setRoleAction).mockRejectedValue(new Error("stale"));
    const onChanged = vi.fn();
    const h = peopleHandlers({ accountId: "a1", groupId: "g1", locale: "en", onChanged });
    await expect(h.roleSave("m1")("Dueña")).resolves.toEqual({ ok: false, error: "That didn't save. Try again." });
  });
});
