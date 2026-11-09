import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { m } from "@/lib/messages";

const db = vi.hoisted(() => ({ team: vi.fn(), brand: vi.fn(), zone: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), listAccountTeam: db.team, getBranding: db.brand, readAccountTimezone: db.zone,
}));
import { sendOwnerLineLockoutEmails, scheduleOwnerLineLockoutEmails } from "./lockout";

const AT = new Date("2026-11-09T20:14:00.000Z");      // 2:14 PM in America/Chicago
const UNTIL = "2026-11-09T20:44:00.000Z";
const P = { accountId: "a1", userId: "u-staff", lockedUntil: UNTIL, at: AT, accountLanguage: "en" as const };
beforeEach(() => {
  db.brand.mockResolvedValue({ brandName: "Rio Roofing" });
  db.zone.mockResolvedValue("America/Chicago");
  db.team.mockResolvedValue([
    { userId: "u-staff", clerkUserId: "c1", email: "dan@example.com", name: "Dan Lopez", role: "staff", language: "es" },
    { userId: "u-owner", clerkUserId: "c2", email: "ana@example.com", name: "Ana", role: "owner", language: null },
  ]);
});

describe("three wrong PINs email the person and the account's Owner (spec §4.2)", () => {
  it("one email each, each in its reader's own language, kind operator.owner_line_lockout, with the time in the account's zone", async () => {
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send).toHaveBeenCalledTimes(2);
    const [self, owner] = send.mock.calls.map((c) => c[0]);
    expect(self).toMatchObject({ accountId: "a1", kind: "operator.owner_line_lockout", to: "dan@example.com" });
    expect(self.body).toContain("2:14");          // es-US renders "2:14 p.m."
    expect(self.subject).toBe("Alguien marcó el PIN incorrecto 3 veces");
    expect(owner).toMatchObject({ to: "ana@example.com" });
    expect(owner.body).toContain("Someone entered the wrong PIN 3 times from Dan's phone at 2:14 PM");
    expect(owner.body).toContain("2:44 PM");
  });

  it("an Owner locked out gets ONE email, and it is the 'from your phone' one, not the third-person one (mutation: drop the has() guard so the owner loop overwrites the entry -> forSelf flips, FAILS)", async () => {
    // A Map keyed by address can never send two, so a count alone could not fail. What the overwrite would change is
    // WHICH email: forSelf false says "from Ana's phone" to Ana. The body is the assertion.
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails({ ...P, userId: "u-owner" }, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].body).toContain("from your phone");
  });

  it("addresses are compared case-insensitively: Dan@ and dan@ are one person, and the sole send goes to the PERSON's own address (not re-sent to the Owner's differently-cased copy)", async () => {
    db.team.mockResolvedValue([
      { userId: "u-owner", clerkUserId: "c2", email: "Ana@Example.com", name: "Ana", role: "owner", language: null },
      { userId: "u-owner2", clerkUserId: "c3", email: "ana@example.com", name: "Ana", role: "owner", language: null },
    ]);
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails({ ...P, userId: "u-owner" }, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].to).toBe("Ana@Example.com");
    expect(send.mock.calls[0]![0].body).toContain("from your phone");
  });

  it("one failed send never stops the other (mutation: drop the per-recipient catch -> FAILS)", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("resend down")).mockResolvedValue({ id: "x" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never names the business by its internal label: the brand name only", async () => {
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send.mock.calls[0]![0].fromName).toBe("Rio Roofing");
  });

  it("the self email's PIN-change instruction names the real menu item, read from the catalogue rather than a literal, in each reader's own language (I-4; mutation: revert to the hard-coded 'Mis preferencias' -> FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ id: "x" });
    // P's own person (u-staff) is Spanish; the Owner locked out instead resolves to English (language: null, falling
    // back to P's accountLanguage "en") — so this exercises the self-email's tail in both languages.
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send.mock.calls[0]![0].body).toContain(m["prefs.menuItem.es"]);
    send.mockClear();
    await sendOwnerLineLockoutEmails({ ...P, userId: "u-owner" }, { send });
    expect(send.mock.calls[0]![0].body).toContain(m["prefs.menuItem"]);
  });
});

// scheduleOwnerLineLockoutEmails runs from a TeXML route's request handler, so it must never escape that call with
// an uncaught throw regardless of what next/server's after() does once there is no request scope to attach to —
// e.g. this very test file, which calls it directly outside any request.
describe("scheduleOwnerLineLockoutEmails is safe to call outside a request scope", () => {
  it("never throws, even outside a request scope — where next/server's after() throws synchronously on its own (mutation: drop the try/catch around after() in scheduleOwnerLineLockoutEmails -> FAILS)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => scheduleOwnerLineLockoutEmails({ accountId: "a1", userId: "u-staff", lockedUntil: UNTIL, accountLanguage: null })).not.toThrow();
  });
});

// m-7: after() defers its callback until after the response is sent, which can be noticeably later than the instant
// the third wrong PIN landed. The email must state THAT instant, not whenever the deferred send happens to run —
// so scheduleOwnerLineLockoutEmails must capture `new Date()` before calling after(), never inside its callback.
// after() throws synchronously outside a request scope (confirmed above) and never runs its callback when it does,
// so observing the captured instant needs a fake after() that defers for real — scoped to this one test via
// vi.doMock + vi.resetModules, so every other test keeps using the real, unmocked next/server.
describe("the lock instant is captured before after() defers the send (m-7)", () => {
  afterEach(() => {
    vi.doUnmock("next/server");
    vi.doUnmock("@/lib/consent/email-gate");
    vi.resetModules();
    vi.useRealTimers();
  });

  it("emails the time the PIN was wrong a third time, not the time the deferred send finally runs (mutation: read new Date() inside the after() callback instead of capturing it before calling after() -> FAILS)", async () => {
    let deferred: (() => unknown) | undefined;
    vi.doMock("next/server", () => ({ after: (fn: () => unknown) => { deferred = fn; } }));
    const sendCapture = vi.fn().mockResolvedValue({ id: "x" });
    vi.doMock("@/lib/consent/email-gate", () => ({ sendEmailOrThrow: sendCapture }));
    vi.resetModules();
    const { scheduleOwnerLineLockoutEmails: schedule } = await import("./lockout");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T20:14:00.000Z"));   // 2:14 PM Chicago: the third wrong PIN, right now
    schedule({ accountId: "a1", userId: "u-staff", lockedUntil: UNTIL, accountLanguage: "en" });
    expect(deferred).toBeDefined();

    vi.setSystemTime(new Date("2026-11-09T20:20:00.000Z"));   // the deferred send actually runs 6 minutes later
    await deferred!();

    // u-staff is not the Owner, so the self email (Spanish: "2:14 p.m.") AND the Owner's English copy both go —
    // both must carry the lock instant, 2:14, never the deferred send's own later clock, 2:20.
    expect(sendCapture).toHaveBeenCalledTimes(2);
    for (const call of sendCapture.mock.calls) {
      expect(call[0]!.body).toContain("2:14");
      expect(call[0]!.body).not.toContain("2:20");
    }
  });
});
