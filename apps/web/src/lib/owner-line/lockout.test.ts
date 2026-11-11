import { describe, it, expect, vi, beforeEach } from "vitest";
import { m } from "@/lib/messages";

const db = vi.hoisted(() => ({ team: vi.fn(), brand: vi.fn(), zone: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), listAccountTeam: db.team, getBranding: db.brand, readAccountTimezone: db.zone,
}));
import { sendOwnerLineLockoutEmails } from "./lockout";
import { EmailNotSent } from "@/lib/consent/email-gate";

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

// The lock-instant capture (m-7) and the never-throws-outside-a-request-scope guard moved with the after() call into
// owner-pin/route.ts (lockoutEmailsAfterResponse), and are pinned there, in owner-pin/route.test.ts.

describe("the lockout emails' failure lines never carry an address (F-032 Task 9 review m-1)", () => {
  it("a send the provider rejects, quoting the recipient, is logged through loggableError: [email], never the address (mutation: log e.message -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn()
      .mockRejectedValueOnce(new EmailNotSent({ kind: "failed", stage: "provider", error: "550 <ana@example.com>: recipient rejected" }))
      .mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails(P, { send });
    const lines = err.mock.calls.flat().map(String).join("\n");
    expect(lines).toContain("owner line lockout email failed for one recipient, accountId a1: EmailNotSent: 550 <[email]>: recipient rejected");
    expect(lines).not.toContain("ana@example.com");
  });

  it("a preparation failure quoting an address is logged through loggableError too (mutation: log String(e) -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.team.mockRejectedValue(new Error("listAccountTeam failed for dan@example.com"));
    await sendOwnerLineLockoutEmails(P, { send: vi.fn() });
    const lines = err.mock.calls.flat().map(String).join("\n");
    expect(lines).toContain("owner line lockout emails could not be prepared, accountId a1: Error: listAccountTeam failed for [email]");
    expect(lines).not.toContain("dan@example.com");
  });
});
