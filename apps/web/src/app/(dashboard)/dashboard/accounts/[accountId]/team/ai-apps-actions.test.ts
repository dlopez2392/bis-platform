import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The AI apps switch's server action (plan 2026-11-19-mcp-server.md D2, 3.4): only the business's own Owner may turn
 * customer data out to an AI app. The agency, Staff, a Technician and another business's Owner are refused with
 * nothing written. requireAccountAccess is mocked as the real guard behaves (an agency admitted, another business's
 * person redirected), and myMembership is the ACTION's own second check, keyed on the account asked.
 */
const mocks = vi.hoisted(() => ({ access: vi.fn(), member: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: mocks.access }));
vi.mock("@/lib/owner-line/memberships", () => ({ myMembership: mocks.member }));
vi.mock("@bis/db", () => ({ serviceDb: () => ({ tag: "service" }), setAiAppsSwitch: mocks.set }));

import { setAiAppsSwitchAction } from "./ai-apps-actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OWNER_USER = "99999999-9999-4999-8999-999999999999";
const ON = { enabledAt: "2026-11-19T20:00:00.000Z", changedAt: "2026-11-19T20:00:00.000Z", changedBy: OWNER_USER };
const OFF = { enabledAt: null, changedAt: "2026-11-19T20:05:00.000Z", changedBy: OWNER_USER };
const mb = (role: string, accountId = A) => ({ accountId, userId: OWNER_USER, role, businessName: "Rio Roofing", number: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ userId: "user_clerk_owner", isAgency: false, role: "owner", canManage: true });
  mocks.member.mockResolvedValue(mb("owner"));
});

describe("setAiAppsSwitchAction (D2: only the business's own Owner)", () => {
  it("the Owner turns it on, and the write names the Owner's users.id, never the Clerk id (mutation: pass the Clerk user id -> FAILS)", async () => {
    mocks.set.mockResolvedValue({ changed: true, state: ON });
    expect(await setAiAppsSwitchAction(A, "en", true)).toEqual({ ok: true, value: ON });
    expect(mocks.member).toHaveBeenCalledWith({ tag: "service" }, "user_clerk_owner", A);
    expect(mocks.set).toHaveBeenCalledWith({ tag: "service" }, A, true, OWNER_USER);
  });

  it("Staff are refused and nothing is written (mutation: drop the role check -> FAILS)", async () => {
    mocks.access.mockResolvedValue({ userId: "user_clerk_staff", isAgency: false, role: "staff", canManage: false });
    mocks.member.mockResolvedValue(mb("staff"));
    expect(await setAiAppsSwitchAction(A, "en", true)).toEqual({ ok: false, error: "Only the business's Owner can change this." });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("a Technician is refused and nothing is written, in Spanish too (mutation: admit every OWNER_LINE_ROLES role -> FAILS)", async () => {
    mocks.member.mockResolvedValue(mb("technician"));
    expect(await setAiAppsSwitchAction(A, "es", true)).toEqual({ ok: false, error: "Solo el Dueño del negocio puede cambiar esto." });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("the agency is refused even when the membership lookup would answer an Owner (mutation: drop the isAgency refusal -> FAILS)", async () => {
    mocks.access.mockResolvedValue({ userId: "user_bis", isAgency: true, role: null, canManage: true });
    mocks.member.mockResolvedValue(mb("owner"));
    expect((await setAiAppsSwitchAction(A, "en", true)).ok).toBe(false);
    expect((await setAiAppsSwitchAction(A, "en", false)).ok).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("another business's Owner is redirected by the guard before anything is read or written", async () => {
    mocks.access.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(setAiAppsSwitchAction(B, "en", true)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("an Owner of ANOTHER business who gets past the guard is still refused: the membership is looked up for the account asked (mutation: look up any account's membership -> FAILS)", async () => {
    mocks.member.mockImplementation(async (_db: unknown, _clerk: string, accountId: string) => (accountId === A ? mb("owner", A) : null));
    expect(await setAiAppsSwitchAction(B, "en", true)).toEqual({ ok: false, error: "Only the business's Owner can change this." });
    expect(mocks.member).toHaveBeenCalledWith({ tag: "service" }, "user_clerk_owner", B);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("Undo restores the previous state: on, then the same action with off, each written once (mutation: Undo repeats the same value -> FAILS)", async () => {
    mocks.set.mockResolvedValueOnce({ changed: true, state: ON }).mockResolvedValueOnce({ changed: true, state: OFF });
    const first = await setAiAppsSwitchAction(A, "en", true);
    const undo = await setAiAppsSwitchAction(A, "en", false);
    expect(first).toEqual({ ok: true, value: ON });
    expect(undo).toEqual({ ok: true, value: OFF });
    expect(mocks.set.mock.calls.map((c) => c[2])).toEqual([true, false]);
  });

  it("OFF asks the guard to allow it during a billing pause, ON asks with no option (the pattern lib/billing/read-only.test.ts pins)", async () => {
    mocks.set.mockResolvedValue({ changed: true, state: OFF });
    await setAiAppsSwitchAction(A, "en", false);
    mocks.set.mockResolvedValue({ changed: true, state: ON });
    await setAiAppsSwitchAction(A, "en", true);
    expect(mocks.access.mock.calls).toEqual([[A, { duringPause: "allow" }], [A]]);
  });

  it("anything but a boolean is refused before any write (a browser-supplied 'false' string must not read as ON; mutation: drop the typeof check -> FAILS)", async () => {
    await expect(setAiAppsSwitchAction(A, "en", "false" as unknown as boolean)).rejects.toThrow("setAiAppsSwitchAction: on must be true or false");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("a failed write answers a plain error and logs the account, never throwing to the browser (mutation: let it throw -> FAILS)", async () => {
    mocks.set.mockRejectedValue(new Error("setAiAppsSwitch failed: connection reset"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setAiAppsSwitchAction(A, "en", true)).toEqual({ ok: false, error: "That did not save. Try again in a moment." });
    expect(err.mock.calls.flat().map(String).join(" ")).toContain(A);
    err.mockRestore();
  });
});
