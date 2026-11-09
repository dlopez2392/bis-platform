import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), set: vi.fn(), emit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountOwner: mocks.owner }));
vi.mock("@bis/db", () => ({ serviceDb: () => ({}), setOwnerLineSwitch: mocks.set, emitAgencyEvent: mocks.emit }));

import { setOwnerLineSwitchAction } from "./owner-line-actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ON = { enabledAt: "2026-11-09T20:00:00.000Z", changedAt: "2026-11-09T20:00:00.000Z", changedByKind: "owner" };
const OFF = { enabledAt: null, changedAt: "2026-11-09T20:00:00.000Z", changedByKind: "agency" };
const OWNER_OFF = { enabledAt: null, changedAt: "2026-11-09T19:00:00.000Z", changedByKind: "owner" };
beforeEach(() => { vi.clearAllMocks(); mocks.emit.mockResolvedValue(undefined); });

describe("the business's switch (F-032 §3.3; owner rulings Q-A and 2026-11-09)", () => {
  it("the client's Owner turns it on as the Owner's kind, and no agency record is written", async () => {
    // requireAccountOwner returns { userId, isAgency } (WEB/lib/auth.ts:104-110); userId is the Clerk user id.
    mocks.owner.mockResolvedValue({ userId: "user_owner", isAgency: false });
    mocks.set.mockResolvedValue({ changed: true, state: ON });
    expect(await setOwnerLineSwitchAction(A, "en", true)).toEqual({ ok: true, value: ON });
    expect(mocks.set).toHaveBeenCalledWith({}, A, true, "owner");
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("the client's Owner turns it off as the Owner's kind, and no agency record is written (mutation: emit on any OFF -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_owner", isAgency: false });
    mocks.set.mockResolvedValue({ changed: true, state: OWNER_OFF });
    expect(await setOwnerLineSwitchAction(A, "en", false)).toEqual({ ok: true, value: OWNER_OFF });
    expect(mocks.set).toHaveBeenCalledWith({}, A, false, "owner");
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("the agency's ON is refused, and nothing is written (mutation: drop the agency-ON refusal -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    const r = await setOwnerLineSwitchAction(A, "es", true);
    expect(r).toEqual({ ok: false, error: "Solo el Dueño del negocio puede encenderlo." });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("the agency's OFF works as the agency's kind, and BIS's own record names the person (mutations: record 'owner' -> FAILS; drop the emit -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    mocks.set.mockResolvedValue({ changed: true, state: OFF });
    expect(await setOwnerLineSwitchAction(A, "en", false)).toEqual({ ok: true, value: OFF });
    expect(mocks.set).toHaveBeenCalledWith({}, A, false, "agency");
    expect(mocks.emit).toHaveBeenCalledWith({}, "owner_line.switch_off", "user_bis", { account_id: A, changed_at: OFF.changedAt });
  });
  it("the agency's OFF on a switch the Owner already turned off changes nothing and records nothing (re-review m-E; mutation: emit without checking changed -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    mocks.set.mockResolvedValue({ changed: false, state: OWNER_OFF });
    expect(await setOwnerLineSwitchAction(A, "en", false)).toEqual({ ok: true, value: OWNER_OFF });
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("staff never reach it: requireAccountOwner redirects them", async () => {
    mocks.owner.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(setOwnerLineSwitchAction(A, "en", true)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("a second business: the guard, the write and BIS's record all name the business asked for, never another (mutation: write a fixed account -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    mocks.set.mockResolvedValue({ changed: true, state: OFF });
    await setOwnerLineSwitchAction(B, "en", false);
    expect(mocks.owner).toHaveBeenCalledWith(B);
    expect(mocks.set).toHaveBeenCalledWith({}, B, false, "agency");
    expect(mocks.emit).toHaveBeenCalledWith({}, "owner_line.switch_off", "user_bis", { account_id: B, changed_at: OFF.changedAt });
  });
  it("anything but a boolean is refused after the guard, before any write (a browser-supplied 'true' must not read as OFF for an Owner or slip past the agency's refusal; mutation: drop the typeof check -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_owner", isAgency: false });
    mocks.set.mockResolvedValue({ changed: true, state: OWNER_OFF });
    await expect(setOwnerLineSwitchAction(A, "en", "true" as unknown as boolean)).rejects.toThrow("setOwnerLineSwitchAction: on must be true or false");
    expect(mocks.owner).toHaveBeenCalledWith(A);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
