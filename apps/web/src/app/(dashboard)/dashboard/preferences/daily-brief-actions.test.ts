import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }),
  my: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/owner-line/memberships", () => ({ myMembership: mocks.my }));
// DAILY_BRIEF_ROLES is the REAL constant (the technician test must read the shipped list, not a copy).
vi.mock("@bis/db", async (orig) => ({
  ...(await orig<typeof import("@bis/db")>()),
  serviceDb: () => ({}),
  subscribeToBrief: mocks.subscribe,
  unsubscribeFromBrief: mocks.unsubscribe,
}));

import { setMyDailyBriefAction } from "./daily-brief-actions";

const A = "11111111-1111-4111-8111-111111111111";
const ME = { accountId: A, userId: "u-me", role: "owner", businessName: "Rio Roofing", number: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user_clerk_me" });
  mocks.my.mockResolvedValue(ME);
  mocks.subscribe.mockResolvedValue({ id: "s1" });
  mocks.unsubscribe.mockResolvedValue(true);
});

describe("setMyDailyBriefAction (daily brief plan D1/D2/D3)", () => {
  it("signed out: redirected, nothing read or written (mutation: drop the !userId redirect -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(setMyDailyBriefAction(A, true)).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.my).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("an impersonation session (Clerk's actor) is refused on and off, before any read, nothing written (mutation: drop the actor refusal -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_clerk_me", actor: { sub: "user_bis_support" } });
    await expect(setMyDailyBriefAction(A, true)).rejects.toThrow("NEXT_REDIRECT /no-access?reason=none");
    await expect(setMyDailyBriefAction(A, false)).rejects.toThrow("NEXT_REDIRECT /no-access?reason=none");
    for (const f of [mocks.my, mocks.subscribe, mocks.unsubscribe]) expect(f).not.toHaveBeenCalled();
  });

  it("an account the person is not a member of is refused, on and off, nothing written (mutation: take the account from the form without the membership check -> FAILS)", async () => {
    mocks.my.mockResolvedValue(null);
    expect(await setMyDailyBriefAction(A, true)).toMatchObject({ ok: false });
    expect(await setMyDailyBriefAction(A, false)).toMatchObject({ ok: false });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("a Technician is refused (mutation: skip the DAILY_BRIEF_ROLES check -> FAILS)", async () => {
    mocks.my.mockResolvedValue({ ...ME, role: "technician" });
    expect(await setMyDailyBriefAction(A, true)).toMatchObject({ ok: false });
    expect(await setMyDailyBriefAction(A, false)).toMatchObject({ ok: false });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("Owner and Staff may turn it on: subscribes THAT person to THAT business", async () => {
    for (const role of ["owner", "staff"]) {
      mocks.subscribe.mockClear();
      mocks.my.mockResolvedValue({ ...ME, role });
      expect(await setMyDailyBriefAction(A, true)).toEqual({ ok: true });
      expect(mocks.subscribe).toHaveBeenCalledWith({}, { userId: "u-me", accountId: A });
    }
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("off deletes by person and business; the Undo (on again) re-runs the inverse and a second off is harmless (mutation: off or Undo that does not write -> FAILS)", async () => {
    expect(await setMyDailyBriefAction(A, false)).toEqual({ ok: true });
    expect(mocks.unsubscribe).toHaveBeenCalledWith({}, { userId: "u-me", accountId: A });
    expect(await setMyDailyBriefAction(A, true)).toEqual({ ok: true });
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    mocks.unsubscribe.mockResolvedValue(false);
    expect(await setMyDailyBriefAction(A, false)).toEqual({ ok: true });
  });

  it("the person is never taken from the caller: an extra argument naming someone else is ignored", async () => {
    const hostile = setMyDailyBriefAction as unknown as (...a: unknown[]) => Promise<unknown>;
    await hostile(A, true, "en", { userId: "u-victim" }, "u-victim");
    expect(mocks.subscribe).toHaveBeenCalledWith({}, { userId: "u-me", accountId: A });
    expect(mocks.my).toHaveBeenCalledWith({}, "user_clerk_me", A);
  });

  it("a non-boolean 'on' or a non-string account is refused before anything is read", async () => {
    const hostile = setMyDailyBriefAction as unknown as (...a: unknown[]) => Promise<unknown>;
    expect(await hostile(A, "false")).toMatchObject({ ok: false });
    expect(await hostile({ id: A }, true)).toMatchObject({ ok: false });
    expect(mocks.my).not.toHaveBeenCalled();
  });

  it("a database failure answers a plain error, never a throw to the browser", async () => {
    mocks.subscribe.mockRejectedValue(new Error("boom: secret detail"));
    const r = await setMyDailyBriefAction(A, true, "es");
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("secret detail");
  });
});
