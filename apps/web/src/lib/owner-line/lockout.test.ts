import { describe, it, expect, vi, beforeEach } from "vitest";

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
});

// Fix-round requirement I-8 / SC-18: the owner-pin route reaches this module only through a DYNAMIC import, inside
// its locked_now branch (`await import("@/lib/owner-line/lockout")`, never a static top-of-file import — that is
// exactly what keeps `@bis/db` out of every TeXML route's module graph at parse time). This module itself,
// and scheduleOwnerLineLockoutEmails specifically, must therefore work correctly when loaded and called from
// outside any Next.js request — which is also exactly the vitest environment these other tests already run in.
describe("I-8: safe to import dynamically, as owner-pin's locked_now branch imports it", () => {
  it("resolves through a dynamic import() (the exact form owner-pin uses) and exposes both exports as functions", async () => {
    const mod = await import("./lockout");
    expect(typeof mod.sendOwnerLineLockoutEmails).toBe("function");
    expect(typeof mod.scheduleOwnerLineLockoutEmails).toBe("function");
  });

  it("scheduleOwnerLineLockoutEmails never throws, even outside a request scope — where next/server's after() throws synchronously on its own (mutation: drop the try/catch around after() in scheduleOwnerLineLockoutEmails -> FAILS)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => scheduleOwnerLineLockoutEmails({ accountId: "a1", userId: "u-staff", lockedUntil: null, accountLanguage: null })).not.toThrow();
  });
});
