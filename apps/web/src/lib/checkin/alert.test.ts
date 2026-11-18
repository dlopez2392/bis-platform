import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { EmailRequest } from "@/lib/consent/email-gate";
import type { Branding, JobCheckin } from "@bis/db";

const dbm = vi.hoisted(() => ({ getBranding: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));

import { EmailNotSent } from "@/lib/consent/email-gate";
import { alertOwnerOfNotGreat, CHECKIN_ALERT_BUDGET_MS } from "./alert";
import { fakeDb, type FakeRow as Row } from "./fake-db";

/**
 * The owner's "not great" alert (F-072, owner decision 2026-11-17): who it goes to, in whose words, how it is sent,
 * and that nothing about it can reach back into the caller. The database is fakeDb, which APPLIES the eq filters,
 * so a read that forgot its account filter finds the wrong row and fails here. The sender is a spy standing in for
 * the gate (FakeEmail territory: nothing here can reach a real address).
 */
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const OTHER = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const BOOKING = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const CAL = "cal-1";
const CONTACT = "11111111-2222-4333-8444-555555555555";
const BRANDING: Branding = { brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#0e7490", brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null };
const checkin: JobCheckin = { id: "chk-1", accountId: ACCT, bookingId: BOOKING, contactId: CONTACT, answer: "not_great", answeredAt: "2027-06-15T12:00:00Z", reviewLinkOpenedAt: null };

const PRIVATE_EMAIL = "ana.private@customer.example";
const PRIVATE_PHONE = "+19565550123";

const world = (over: Partial<Record<string, Row[]>> = {}) => fakeDb({
  // 03:00Z is the evening of the 14th in Chicago: the day is the ACCOUNT's, not UTC's.
  bookings: [{ id: BOOKING, account_id: ACCT, calendar_id: CAL, starts_at: "2027-06-15T03:00:00Z" }],
  calendars: [{ id: CAL, account_id: ACCT, notify_emails: ["owner@rio.example", "office@rio.example"] }],
  contacts: [{ id: CONTACT, account_id: ACCT, first_name: "Ana", last_name: "García", email: PRIVATE_EMAIL, phone: PRIVATE_PHONE }],
  accounts: [{ id: ACCT, language: "en", timezone: "America/Chicago" }],
  ...over,
});

let send: Mock<(req: EmailRequest) => Promise<unknown>>;
beforeEach(() => {
  dbm.getBranding.mockReset().mockResolvedValue(BRANDING);
  send = vi.fn<(req: EmailRequest) => Promise<unknown>>().mockResolvedValue({ providerMessageId: "m1" });
  vi.stubEnv("APP_ORIGIN", "https://app.example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("alertOwnerOfNotGreat", () => {
  it("emails each address on the booking calendar's list, once each, as operator.checkin_alert in the brand's name (mutation: skip the send -> FAILS)", async () => {
    const { db } = world();
    const out = await alertOwnerOfNotGreat(db, checkin, { send });
    expect(out).toEqual({ sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["owner@rio.example", "office@rio.example"]);
    const req = send.mock.calls[0]![0];
    expect(req).toMatchObject({
      accountId: ACCT, kind: "operator.checkin_alert", fromName: "Rio Roofing", language: "en",
      subject: "Ana García said the job was not great",
    });
    expect(req.body).toContain("Ana García said the job on Monday, June 14 was not great.");
    expect(req.html).toContain(`href="https://app.example.com/dashboard/accounts/${ACCT}/contacts/${CONTACT}"`);
    expect(req).not.toHaveProperty("fromAddress");
  });

  it("shows neither the customer's email address nor phone number anywhere in the subject, the text or the html (mutation: read email or phone into the name -> FAILS)", async () => {
    await alertOwnerOfNotGreat(world().db, checkin, { send });
    for (const [req] of send.mock.calls) {
      for (const part of [req.subject, req.body, req.html ?? ""]) {
        expect(part).not.toContain(PRIVATE_EMAIL);
        expect(part).not.toContain("customer.example");
        expect(part).not.toContain("5550123");
      }
    }
  });

  it("reads the customer in the check-in's account: a same-id contact elsewhere, with another name, is never used (mutation: drop the contacts account filter -> FAILS)", async () => {
    const { db } = world({ contacts: [
      { id: CONTACT, account_id: OTHER, first_name: "Wrong", last_name: "Person" },
      { id: CONTACT, account_id: ACCT, first_name: "Ana", last_name: "García" },
    ] });
    await alertOwnerOfNotGreat(db, checkin, { send });
    expect(send.mock.calls[0]![0].subject).toBe("Ana García said the job was not great");
    expect(send.mock.calls[0]![0].body).not.toContain("Wrong");
  });

  it("an address whose key would be long still gets a short, deterministic, distinct key (the address is hashed)", async () => {
    const long = `${"x".repeat(300)}@rio.example`;
    const { db } = world({ calendars: [{ id: CAL, account_id: ACCT, notify_emails: [long, "owner@rio.example"] }] });
    await alertOwnerOfNotGreat(db, checkin, { send });
    await alertOwnerOfNotGreat(db, checkin, { send });
    const keys = send.mock.calls.map((c) => c[0].idempotencyKey as string);
    expect(keys.every((k) => k.length <= 256 && k.startsWith("checkin-alert/chk-1/"))).toBe(true);
    expect(keys.some((k) => k.includes("xxxx"))).toBe(false);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.slice(2)).toEqual(keys.slice(0, 2));
  });

  it("an account the gate holds back (suppressed_account, a demo tenant) is a deliberate skip, not a failure, and not logged as an error", async () => {
    send.mockRejectedValue(new EmailNotSent({ kind: "blocked", reason: "suppressed_account" }));
    expect(await alertOwnerOfNotGreat(world().db, checkin, { send })).toEqual({ sent: 0, failed: 0, skipped: "suppressed" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("any other gate block is still a failure, logged", async () => {
    send.mockRejectedValue(new EmailNotSent({ kind: "blocked", reason: "suppressed" }));
    expect(await alertOwnerOfNotGreat(world().db, checkin, { send })).toEqual({ sent: 0, failed: 2 });
    expect(console.error).toHaveBeenCalled();
  });

  it("every send carries an idempotency key made from the check-in's id, distinct per address (Resend would call one shared key a duplicate) (mutation: drop the key -> FAILS)", async () => {
    await alertOwnerOfNotGreat(world().db, checkin, { send });
    const keys = send.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys.every((k) => typeof k === "string" && k.startsWith("checkin-alert/chk-1/"))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    await alertOwnerOfNotGreat(world().db, checkin, { send });
    expect(send.mock.calls.slice(2).map((c) => c[0].idempotencyKey)).toEqual(keys);
  });

  it("reads the recipients in the CHECK-IN's account: another account's calendar with the same id is never used (mutation: drop the calendars account filter -> FAILS)", async () => {
    const { db } = world({ calendars: [
      { id: CAL, account_id: OTHER, notify_emails: ["stranger@other.example"] },
      { id: CAL, account_id: ACCT, notify_emails: ["owner@rio.example"] },
    ] });
    await alertOwnerOfNotGreat(db, checkin, { send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["owner@rio.example"]);
  });

  it("reads the booking in the check-in's account too: another account's booking row never picks the calendar (mutation: drop the bookings account filter -> FAILS)", async () => {
    const { db } = world({
      bookings: [
        { id: BOOKING, account_id: OTHER, calendar_id: "cal-other", starts_at: "2027-06-01T15:00:00Z" },
        { id: BOOKING, account_id: ACCT, calendar_id: CAL, starts_at: "2027-06-15T03:00:00Z" },
      ],
      calendars: [
        { id: "cal-other", account_id: ACCT, notify_emails: ["wrong@rio.example"] },
        { id: CAL, account_id: ACCT, notify_emails: ["owner@rio.example"] },
      ],
    });
    await alertOwnerOfNotGreat(db, checkin, { send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["owner@rio.example"]);
  });

  it("an empty list sends nothing and says so under its own name", async () => {
    const { db } = world({ calendars: [{ id: CAL, account_id: ACCT, notify_emails: [] }] });
    expect(await alertOwnerOfNotGreat(db, checkin, { send })).toEqual({ sent: 0, failed: 0, skipped: "no_recipients" });
    expect(send).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("no addresses");
  });

  it("a booking with no calendar (or no booking row) is the same: nothing sent, counted as no recipients", async () => {
    for (const bookings of [[{ id: BOOKING, account_id: ACCT, calendar_id: null, starts_at: "2027-06-15T03:00:00Z" }], []]) {
      expect(await alertOwnerOfNotGreat(world({ bookings }).db, checkin, { send })).toEqual({ sent: 0, failed: 0, skipped: "no_recipients" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("blank and repeated addresses are dropped: no empty recipient, no address emailed twice", async () => {
    const { db } = world({ calendars: [{ id: CAL, account_id: ACCT, notify_emails: [" owner@rio.example ", "", "OWNER@rio.example", "  "] }] });
    await alertOwnerOfNotGreat(db, checkin, { send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["owner@rio.example"]);
  });

  it("a Spanish account's alert is Spanish through the subject, the day and the button", async () => {
    const { db } = world({ accounts: [{ id: ACCT, language: "es", timezone: "America/Chicago" }] });
    await alertOwnerOfNotGreat(db, checkin, { send });
    const req = send.mock.calls[0]![0];
    expect(req.language).toBe("es");
    expect(req.subject).toBe("Ana García dijo que el trabajo no estuvo bien");
    expect(req.body).toContain("Ana García dijo que el trabajo del lunes 14 de junio no estuvo bien.");
    expect(req.html).toContain("Abrir este contacto");
  });

  it("with no stored name it says 'A customer'; with no usable timezone it names no day", async () => {
    const { db } = world({
      contacts: [{ id: CONTACT, account_id: ACCT, first_name: null, last_name: null }],
      accounts: [{ id: ACCT, language: "en", timezone: null }],
    });
    await alertOwnerOfNotGreat(db, checkin, { send });
    const req = send.mock.calls[0]![0];
    expect(req.subject).toBe("A customer said the job was not great");
    expect(req.body).toContain("A customer said the job was not great.");
    expect(req.body).not.toMatch(/job on /);
  });

  it("APP_ORIGIN unset: the alert still goes, without a button or a path (the alert is the point; the link is a convenience)", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    await alertOwnerOfNotGreat(world().db, checkin, { send });
    expect(send).toHaveBeenCalledTimes(2);
    const req = send.mock.calls[0]![0];
    expect(req.html).not.toContain("href=");
    expect(req.body).not.toContain("/dashboard");
  });

  it("one address that fails does not stop the next, and nothing throws (a send failure never reaches the caller)", async () => {
    send.mockRejectedValueOnce(new Error("provider down"));
    const out = await alertOwnerOfNotGreat(world().db, checkin, { send });
    expect(out).toEqual({ sent: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.error).mock.calls.join("\n")).toContain("provider down");
  });

  it("an unreadable brand (or any read that fails) is a counted failure, never a throw", async () => {
    dbm.getBranding.mockRejectedValue(new Error("branding read failed"));
    expect(await alertOwnerOfNotGreat(world().db, checkin, { send })).toEqual({ sent: 0, failed: 1, skipped: "unreadable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a provider that never answers cannot hold the caller past the budget (the page's response is never hostage to an inbox)", async () => {
    vi.useFakeTimers();
    send.mockImplementation(() => new Promise(() => {}));
    const pending = alertOwnerOfNotGreat(world().db, checkin, { send });
    await vi.advanceTimersByTimeAsync(CHECKIN_ALERT_BUDGET_MS + 1);
    expect(await pending).toEqual({ sent: 0, failed: 1, skipped: "timed_out" });
    expect(CHECKIN_ALERT_BUDGET_MS).toBeLessThanOrEqual(6000);
  });
});
