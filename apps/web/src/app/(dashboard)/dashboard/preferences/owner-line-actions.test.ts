import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }),
  my: vi.fn(),
  phone: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  setPin: vi.fn(),
  removePin: vi.fn(),
  removeCell: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/owner-line/memberships", () => ({ myMembership: mocks.my }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), OWNER_LINE_VERIFY_MINUTES: 10,
  getPhoneNumberByE164: mocks.phone, readMyOwnerLineEnrollment: mocks.read, startOwnerLineVerification: mocks.start,
  setOwnerLinePin: mocks.setPin, removeOwnerLinePin: mocks.removePin, removeOwnerLineEnrollment: mocks.removeCell,
}));

import {
  startOwnerLineVerificationAction, setOwnerLinePinAction, removeOwnerLinePinAction, removeOwnerLineCellAction,
} from "./owner-line-actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ME = { accountId: A, userId: "u-me", role: "staff", businessName: "Rio Roofing", number: "+19565550100" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_LINE_PIN_PEPPER = "p".repeat(40);
  mocks.auth.mockResolvedValue({ userId: "user_clerk_me" });
  mocks.my.mockResolvedValue(ME);
  mocks.phone.mockResolvedValue(null);
  mocks.read.mockResolvedValue(null);
  mocks.start.mockResolvedValue("ok");
  mocks.setPin.mockResolvedValue(true);
});

describe("the owner line's setup actions (F-032 §3.1, §3.2; SC-4)", () => {
  it("signed out: redirected, nothing written (mutation: drop the !userId redirect -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(startOwnerLineVerificationAction(A, "en", "956 555 0142")).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("an impersonation session (Clerk's actor) is refused on all four setup actions, before any read, with nothing written (owner ruling 2026-11-09, review I-3; lib/auth.ts:69's pattern; mutation: drop the actor refusal in member() -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_clerk_me", actor: { sub: "user_bis_support" } });
    mocks.my.mockResolvedValue({ ...ME, role: "owner" });
    const refused = "NEXT_REDIRECT /no-access?reason=none";
    await expect(startOwnerLineVerificationAction(A, "en", "956 555 0142")).rejects.toThrow(refused);
    await expect(setOwnerLinePinAction(A, "en", "482913")).rejects.toThrow(refused);
    await expect(removeOwnerLinePinAction(A, "en")).rejects.toThrow(refused);
    await expect(removeOwnerLineCellAction(A, "en")).rejects.toThrow(refused);
    for (const f of [mocks.my, mocks.phone, mocks.read, mocks.start, mocks.setPin, mocks.removePin, mocks.removeCell]) {
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("not a member of the named business: refused, nothing written (mutation: skip the membership check -> FAILS)", async () => {
    mocks.my.mockResolvedValue(null);
    expect(await startOwnerLineVerificationAction(A, "en", "956 555 0142")).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("a role the data path does not offer is refused like a non-member (F2: a Technician; mutation: drop the OWNER_LINE_ROLES filter in me() -> FAILS)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/owner-line/data-path", () => ({ OWNER_LINE_DATA_PATH: "service", OWNER_LINE_ROLES: ["owner", "staff"] }));
    const { startOwnerLineVerificationAction: start } = await import("./owner-line-actions");
    mocks.my.mockResolvedValue({ ...ME, role: "technician" });
    expect(await start(A, "en", "956 555 0142")).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/owner-line/data-path");
  });

  it("the decided data path (O-1 = F2) refuses a Technician enrolment, verification, a PIN and a PIN change, with the real data-path module (mutation: OWNER_LINE_ROLES gains 'technician' -> FAILS)", async () => {
    mocks.my.mockResolvedValue({ ...ME, role: "technician" });
    const refused = { ok: false, error: "You can't set this up for that business." };
    expect(await startOwnerLineVerificationAction(A, "en", "956 555 0142")).toEqual(refused);
    expect(await setOwnerLinePinAction(A, "en", "482913")).toEqual(refused);
    expect(await removeOwnerLinePinAction(A, "en")).toEqual(refused);
    for (const f of [mocks.start, mocks.setPin, mocks.removePin, mocks.read, mocks.phone]) expect(f).not.toHaveBeenCalled();
  });

  it("Stop calling in works for ANY current member: a Technician (Staff demoted after enrolling) removes their own enrolment, and only their own (coordinator fix 2; mutation: apply OWNER_LINE_ROLES to the removal -> FAILS)", async () => {
    mocks.my.mockResolvedValue({ ...ME, userId: "u-tech", role: "technician" });
    expect(await removeOwnerLineCellAction(A, "en")).toEqual({ ok: true, value: null });
    expect(mocks.my).toHaveBeenCalledWith({}, "user_clerk_me", A);
    expect(mocks.removeCell.mock.calls).toEqual([[{}, A, "u-tech"]]);
  });

  it("Stop calling in still needs a current membership of that business: a non-member is refused and nothing is deleted (mutation: drop the membership check on the removal -> FAILS)", async () => {
    mocks.my.mockResolvedValue(null);
    expect(await removeOwnerLineCellAction(A, "en")).toEqual({ ok: false, error: "You can't set this up for that business." });
    expect(mocks.removeCell).not.toHaveBeenCalled();
  });

  it("Stop calling in, signed out: redirected, nothing deleted", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(removeOwnerLineCellAction(A, "en")).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.removeCell).not.toHaveBeenCalled();
  });

  it("an Owner enrols as well as Staff (the decided roles are exactly owner and staff)", async () => {
    mocks.my.mockResolvedValue({ ...ME, role: "owner" });
    expect(await startOwnerLineVerificationAction(A, "en", "956 555 0142")).toMatchObject({ ok: true });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("no pepper: the PIN is refused with words and nothing is stored (O-3)", async () => {
    delete process.env.OWNER_LINE_PIN_PEPPER;
    expect(await setOwnerLinePinAction(A, "en", "482913")).toEqual({ ok: false, error: "Calling in is not ready yet. Try again later." });
    expect(mocks.setPin).not.toHaveBeenCalled();
  });

  it("writes as the signed-in person only: the user id comes from the Clerk session's membership, never an argument", async () => {
    const r = await startOwnerLineVerificationAction(A, "en", "(956) 555-0142");
    expect(r).toMatchObject({ ok: true, value: { code: expect.stringMatching(/^[0-9]{6}$/) } });
    expect(mocks.my).toHaveBeenCalledWith({}, "user_clerk_me", A);
    expect(mocks.start).toHaveBeenCalledWith({}, A, "u-me", "+19565550142", expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("the person gets the code they will key in, once, and never its hash: the value is exactly { code, expiresAt }, and the stored hash is that code's (mutation: return the hash -> FAILS)", async () => {
    const before = Date.now();
    const r = await startOwnerLineVerificationAction(A, "en", "956 555 0142");
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(r.value).sort()).toEqual(["code", "expiresAt"]);
    const stored = mocks.start.mock.calls[0]![4] as string;
    expect(stored).toBe(createHash("sha256").update(r.value.code, "utf8").digest("hex"));
    expect(JSON.stringify(r)).not.toContain(stored);
    const exp = Date.parse(r.value.expiresAt);
    expect(exp - before).toBeGreaterThanOrEqual(10 * 60_000);
    expect(exp - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it("one person never touches another's enrolment: two signed-in people on the same business each write only their own row", async () => {
    mocks.my.mockImplementation(async (_db: unknown, clerk: string) =>
      clerk === "user_clerk_ana" ? { ...ME, userId: "u-ana" } : clerk === "user_clerk_ben" ? { ...ME, userId: "u-ben" } : null);
    mocks.auth.mockResolvedValue({ userId: "user_clerk_ana" });
    await removeOwnerLineCellAction(A, "en");
    await setOwnerLinePinAction(A, "en", "482913");
    mocks.auth.mockResolvedValue({ userId: "user_clerk_ben" });
    await removeOwnerLinePinAction(A, "en");
    expect(mocks.removeCell.mock.calls).toEqual([[{}, A, "u-ana"]]);
    expect(mocks.setPin.mock.calls.map((c) => c.slice(0, 3))).toEqual([[{}, A, "u-ana"]]);
    expect(mocks.removePin.mock.calls).toEqual([[{}, A, "u-ben"]]);
  });

  it("a second business: the membership is looked up for the business asked for, and the write names it (mutation: write to the first membership found -> FAILS)", async () => {
    mocks.my.mockImplementation(async (_db: unknown, _clerk: string, accountId: string) =>
      accountId === B ? { ...ME, accountId: B, userId: "u-me-b" } : null);
    expect(await startOwnerLineVerificationAction(A, "en", "956 555 0142")).toMatchObject({ ok: false });
    expect(await startOwnerLineVerificationAction(B, "en", "956 555 0142")).toMatchObject({ ok: true });
    expect(mocks.start.mock.calls.map((c) => c.slice(0, 4))).toEqual([[{}, B, "u-me-b", "+19565550142"]]);
  });

  it("refuses a business's own number as a cell (it would ring straight back into Sofía)", async () => {
    mocks.phone.mockResolvedValue({ id: "pn" });
    expect(await startOwnerLineVerificationAction(A, "en", "+19565550100")).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("a number that is not a phone number is refused with words, and nothing is looked up or written", async () => {
    expect(await startOwnerLineVerificationAction(A, "en", "call me")).toEqual({ ok: false, error: "Enter your cell number with its area code." });
    expect(mocks.phone).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("the cell already verified is not restarted", async () => {
    mocks.read.mockResolvedValue({ id: "e", e164: "+19565550142", verifiedAt: "2026-11-09T20:00:00.000Z", verifyExpiresAt: null, pinSetAt: null, lockedUntil: null });
    expect(await startOwnerLineVerificationAction(A, "en", "956 555 0142")).toMatchObject({ ok: false });
    expect(mocks.read).toHaveBeenCalledWith({}, A, "u-me");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("a cell someone else on the business holds is refused with words", async () => {
    mocks.start.mockResolvedValue("taken");
    expect(await startOwnerLineVerificationAction(A, "es", "+19565550142")).toEqual({
      ok: false, error: "Otra persona de su equipo ya usa ese celular aquí." });
  });

  it("a trivial PIN is refused with its reason, and nothing is hashed or stored (mutation: skip checkPin -> FAILS)", async () => {
    expect(await setOwnerLinePinAction(A, "en", "123456")).toEqual({ ok: false, error: "Avoid digits in a row. A PIN like 123456 is too easy to guess." });
    expect(await setOwnerLinePinAction(A, "es", "000000")).toEqual({ ok: false, error: "Use dígitos distintos. Un PIN como 000000 es muy fácil de adivinar." });
    expect(await setOwnerLinePinAction(A, "en", "48291")).toEqual({ ok: false, error: "Your PIN must be exactly 6 digits." });
    expect(mocks.setPin).not.toHaveBeenCalled();
  });

  it("a good PIN is stored as an 80-character scrypt string, never the digits, and the answer carries nothing back", async () => {
    expect(await setOwnerLinePinAction(A, "en", "482913")).toEqual({ ok: true, value: null });
    const stored = mocks.setPin.mock.calls[0]![3] as string;
    expect(stored).toHaveLength(80);
    expect(stored.startsWith("scrypt:17:8:1:")).toBe(true);
    expect(stored).not.toContain("482913");
  });

  it("a PIN before the cell is verified is refused", async () => {
    mocks.setPin.mockResolvedValue(false);
    expect(await setOwnerLinePinAction(A, "en", "482913")).toEqual({ ok: false, error: "Verify your cell first." });
  });

  it("removing the PIN and the cell act on the signed-in person's row only", async () => {
    expect(await removeOwnerLinePinAction(A, "en")).toEqual({ ok: true, value: null });
    expect(await removeOwnerLineCellAction(A, "en")).toEqual({ ok: true, value: null });
    expect(mocks.removePin).toHaveBeenCalledWith({}, A, "u-me");
    expect(mocks.removeCell).toHaveBeenCalledWith({}, A, "u-me");
  });
});
