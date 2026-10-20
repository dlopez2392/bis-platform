import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAct } from "@bis/db/ai-act-rules";

const bis = vi.hoisted(() => ({ loadAccountBrandInfo: vi.fn() }));
vi.mock("@bis/db", () => bis);
const gate = vi.hoisted(() => ({ sendEmailOrThrow: vi.fn() }));
vi.mock("@/lib/consent/email-gate", () => gate);

import { sendBookingUndoNotice } from "./notify";

/**
 * The customer's notice when staff undo one of Sofía's booking changes (item 8c, plan Task 5 item 5; D3,
 * owner Q2 and Q3): the usual booking message for what the booking is NOW, in the customer's own language
 * (their record's, else the account's, else English), through the gate as `booking.undo_notice`.
 */

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const reads: { table: string; eqs: [string, unknown][] }[] = [];
  return {
    reads,
    db: {
      from(table: string) {
        const eqs: [string, unknown][] = [];
        reads.push({ table, eqs });
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
          maybeSingle: () => {
            const hit = (tables[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
            return Promise.resolve({ data: hit[0] ?? null, error: null });
          },
        };
        return chain;
      },
    } as never,
  };
}

const ZONE = "America/Chicago";
const brand = (language: "en" | "es" | null) => new Map([["A", {
  accountTimezone: ZONE, accountLanguage: language, fromEmail: "hello@rio.example", replyToEmail: " owner@rio.example ",
  outboundSuppressed: false, mailingAddress: null,
  branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
}]]);
const base = { id: "act1", accountId: "A", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  createdAt: "2026-10-19T16:00:00.000Z", undoneAt: "2026-10-20T16:00:00.000Z", undoneBy: "user_me", undoNotified: false };
const START = "2026-10-22T15:00:00.000Z";   // Thu, Oct 22, 10:00 AM CDT
const OLD = "2026-10-23T19:30:00.000Z";     // Fri, Oct 23, 2:30 PM CDT
const created: AiAct = { ...base, kind: "booking_created", target: { bookingId: "b1" }, before: null, after: { startsAt: START, endsAt: "2026-10-22T16:00:00.000Z" } };
const cancelled: AiAct = { ...base, kind: "booking_cancelled", target: { bookingId: "b1" }, before: { startsAt: START, endsAt: "2026-10-22T16:00:00.000Z" }, after: { version: "v" } };
const moved: AiAct = { ...base, kind: "booking_rescheduled", target: { bookingId: "bNew", fromBookingId: "bOld" },
  before: { startsAt: OLD, endsAt: "2026-10-23T20:30:00.000Z", version: "v" }, after: { startsAt: START, endsAt: "2026-10-22T16:00:00.000Z" } };

const TOKEN = "abcdefghijkmnpqrstuvwxyz";
const OTHER = "zyxwvutsrqpnmkjihgfedcba";
const tables = {
  bookings: [
    { id: "b1", account_id: "B", calendar_id: "calB", cancel_token: OTHER, meeting_url: null, starts_at: START },
    { id: "b1", account_id: "A", calendar_id: "cal1", cancel_token: TOKEN, meeting_url: "https://meet.example/r1", starts_at: START },
    { id: "bOld", account_id: "A", calendar_id: "cal1", cancel_token: TOKEN, meeting_url: null, starts_at: OLD },
  ],
  calendars: [{ id: "calB", account_id: "B", public_id: "pubB" }, { id: "cal1", account_id: "A", public_id: "pub1" }],
};
const sent = () => gate.sendEmailOrThrow.mock.calls[0]![0] as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  bis.loadAccountBrandInfo.mockResolvedValue(brand("en"));
  gate.sendEmailOrThrow.mockResolvedValue({ providerMessageId: "m1" });
});

describe("sendBookingUndoNotice", () => {
  it("a booking Sofía made, undone: the cancellation, as booking.undo_notice, to their email, from the brand", async () => {
    const { db } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: created, contact: { email: "ana@example.com", language: null }, origin: "https://app.example" });
    expect(sent()).toMatchObject({
      accountId: "A", kind: "booking.undo_notice", contactId: "c1", language: "en", origin: "https://app.example",
      to: "ana@example.com", fromName: "Rio Roofing", fromAddress: "hello@rio.example", replyTo: "owner@rio.example",
      subject: "Your booking has been cancelled",
    });
    expect(sent().body).toContain("Thu, Oct 22, 10:00 AM CDT");
  });

  it("a Spanish customer on an English account reads it in Spanish, subject, date and all (S-09; mutation: the account's language first -> FAILS)", async () => {
    const { db } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: created, contact: { email: "ana@example.com", language: "es" }, origin: null });
    expect(sent()).toMatchObject({ language: "es", subject: "Tu cita fue cancelada" });
    expect(sent().body).toContain("jue, 22 de oct, 10:00 a.m. CDT");
  });

  it("with no language on the record, the account's", async () => {
    bis.loadAccountBrandInfo.mockResolvedValue(brand("es"));
    const { db } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: created, contact: { email: "ana@example.com", language: null }, origin: null });
    expect(sent()).toMatchObject({ language: "es", subject: "Tu cita fue cancelada" });
  });

  it("a cancel undone: the confirmation, with this account's booking's own cancel link, calendar file and video link (second account holds the same id)", async () => {
    const { db, reads } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: cancelled, contact: { email: "ana@example.com", language: null }, origin: "https://app.example" });
    expect(sent().subject).toBe("You're booked in");
    expect(sent().body).toContain(`https://app.example/b/pub1/cancel/${TOKEN}`);
    expect(sent().body).toContain(`Add to your calendar: https://app.example/b/pub1/ics/${TOKEN}`);
    expect(sent().html).toContain("https://meet.example/r1");
    expect(sent().body).not.toContain(OTHER);
    for (const r of reads) expect(r.eqs).toContainEqual(["account_id", "A"]);
  });

  it("A6: a move undone is the restored OLD time, with its own links, and NO calendar file: the moved time's file carries a higher SEQUENCE, so a file for the old time would never replace it in their calendar (mutation: offer calendarFileUrl -> FAILS)", async () => {
    const { db } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: moved, contact: { email: "ana@example.com", language: "es" }, origin: "https://app.example" });
    expect(sent().subject).toBe("Tu cita fue reprogramada");
    expect(sent().body).toContain("vie, 23 de oct, 2:30 p.m. CDT");
    expect(sent().body).toContain(`https://app.example/b/pub1/cancel/${TOKEN}?locale=es`);
    expect(sent().body).toContain(`https://app.example/b/pub1/move/${TOKEN}?locale=es`);
    expect(sent().body).not.toContain("/ics/");
    expect(sent().body).not.toContain("Agregar a tu calendario");
  });

  it("review I-1: a move undone asks them to change their calendar back, in their language, in both parts; the other two notices do not (mutation: drop the sentence -> FAILS)", async () => {
    const EN = "If you added the new time to your calendar, please change it back to this one.";
    const ES = "Si agregó la nueva hora a su calendario, por favor cámbiela de nuevo a esta.";
    const { db } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: moved, contact: { email: "ana@example.com", language: "en" }, origin: "https://app.example" });
    expect(sent().body).toContain(EN);
    expect(sent().html).toContain(EN);
    gate.sendEmailOrThrow.mockClear();
    await sendBookingUndoNotice({ db, accountId: "A", act: moved, contact: { email: "ana@example.com", language: "es" }, origin: "https://app.example" });
    expect(sent().body).toContain(ES);
    expect(sent().html).toContain(ES);
    expect(sent().body).not.toContain(EN);
    for (const act of [created, cancelled]) {
      gate.sendEmailOrThrow.mockClear();
      await sendBookingUndoNotice({ db, accountId: "A", act, contact: { email: "ana@example.com", language: "en" }, origin: "https://app.example" });
      expect(sent().body).not.toContain(EN);
    }
  });

  it("no origin: no links at all, never a link to nowhere", async () => {
    const { db } = fakeDb(tables);
    await sendBookingUndoNotice({ db, accountId: "A", act: cancelled, contact: { email: "ana@example.com", language: null }, origin: null });
    expect(sent().body).not.toContain("/b/");
  });

  it("refuses to send with no email on file, and a gate refusal throws to the caller (which answers 'not told')", async () => {
    const { db } = fakeDb(tables);
    await expect(sendBookingUndoNotice({ db, accountId: "A", act: created, contact: { email: "  ", language: null }, origin: null })).rejects.toThrow(/no email/);
    expect(gate.sendEmailOrThrow).not.toHaveBeenCalled();
    gate.sendEmailOrThrow.mockRejectedValue(new Error("email not sent: suppressed"));
    await expect(sendBookingUndoNotice({ db, accountId: "A", act: created, contact: { email: "ana@example.com", language: null }, origin: null })).rejects.toThrow(/suppressed/);
  });

  it("a booking the account does not hold is an error, never another account's", async () => {
    const { db } = fakeDb({ ...tables, bookings: tables.bookings.filter((b) => b.account_id === "B") });
    await expect(sendBookingUndoNotice({ db, accountId: "A", act: cancelled, contact: { email: "ana@example.com", language: null }, origin: null })).rejects.toThrow(/b1/);
    expect(gate.sendEmailOrThrow).not.toHaveBeenCalled();
  });
});
