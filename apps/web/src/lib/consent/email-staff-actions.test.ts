import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn(), readConsentHistory: vi.fn(), readConsentEvent: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { stopEmails, undoStopEmails, resumeEmails, type EmailContext } from "./email-staff-actions";
import { m } from "@/lib/messages";

const READER = { reader: true } as never;
const WRITER = { writer: true } as never;
const NOW = new Date("2026-10-06T20:00:00Z");
const FRESH = "2026-10-06T19:59:30Z";
const ctx: EmailContext = {
  db: READER, writer: WRITER, accountId: "a1", contactId: "c1", userId: "user_1", actorName: "Ana",
  address: "ana@example.com", now: NOW,
};
let n = 0;
const row = (action: string, method: string, at = `2026-10-0${++n}T10:00:00Z`) =>
  ({ id: `ev_${n}`, action, method, occurred_at: at, evidence: {}, note: null, actor_id: null });
const eventOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[1];
const guardOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[2];

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  n = 0;
  db.readConsentHistory.mockResolvedValue([]);
  db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "new_1", prior: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stopEmails", () => {
  it("writes revoked / staff on the EMAIL channel through the service client, compare-and-set on the row the operator saw, with an Undo (mutation: channel 'sms' → FAILS; mutation: guard 'none' → FAILS)", async () => {
    const r = await stopEmails(ctx, null);
    expect(db.appendConsentEventGuarded.mock.calls[0]![0]).toBe(WRITER);
    expect(eventOf()).toMatchObject({ channel: "email", address: "ana@example.com", action: "revoked", method: "staff", actorId: "user_1", contactId: "c1", evidence: { actorName: "Ana" } });
    expect(guardOf()).toEqual({ ifNewest: null });
    expect(r).toMatchObject({ ok: true, undo: { kind: "stop", eventId: "new_1" } });
  });

  it("over a customer's own stop it writes NOTHING and answers where things stand (choice 19; mutation: drop the read-first check → the write is attempted, FAILS)", async () => {
    db.readConsentHistory.mockResolvedValue([row("revoked", "one_click")]);
    const r = await stopEmails(ctx, "ev_1");
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, error: m["contact.email.changed"], view: { kind: "stopped" } });
  });

  it("a stale click (the newest row moved) is refused, never applied (mutation: ignore expectNewest → FAILS)", async () => {
    db.readConsentHistory.mockResolvedValue([row("resubscribed", "unsubscribe_page")]);
    expect(await stopEmails(ctx, null)).toMatchObject({ ok: false, error: m["contact.email.changed"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("undoStopEmails", () => {
  it("lifts ONLY that staff member's own stop, young, on this address and channel, as staff_undo (G20; mutation: allow another user's row → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff", FRESH), actor_id: "user_1", channel: "email", address: "ana@example.com", contact_id: "c1" });
    expect(await undoStopEmails(ctx, "ev_1")).toMatchObject({ ok: true });
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff_undo", evidence: { undoes: "ev_1" } });
    db.appendConsentEventGuarded.mockClear();
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff", FRESH), actor_id: "user_2", channel: "email", address: "ana@example.com", contact_id: "c1" });
    expect(await undoStopEmails(ctx, "ev_2")).toMatchObject({ ok: false, error: m["contact.email.undoExpired"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("refuses an SMS row of any address, and a customer's stop (mutation: skip the channel check → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff", FRESH), actor_id: "user_1", channel: "sms", address: "ana@example.com", contact_id: "c1" });
    expect(await undoStopEmails(ctx, "ev_1")).toMatchObject({ ok: false });
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "one_click", FRESH), actor_id: null, channel: "email", address: "ana@example.com", contact_id: null });
    expect(await undoStopEmails(ctx, "ev_2")).toMatchObject({ ok: false });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("resumeEmails", () => {
  it("needs a note; resumes a staff or folded stop with it, as resubscribed / staff (choice 19; mutation: accept an empty note → FAILS)", async () => {
    expect(await resumeEmails(ctx, "ev_1", "   ")).toEqual({ ok: false, error: m["contact.email.resumeNoteRequired"] });
    db.readConsentHistory.mockResolvedValue([row("revoked", "backfill_0049")]);
    expect(await resumeEmails(ctx, "ev_1", " They asked on the phone ")).toMatchObject({ ok: true });
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff", note: "They asked on the phone" });
    expect(guardOf()).toEqual({ ifNewest: "ev_1" });
  });

  it("refuses to resume a customer's own unsubscribe (choice 19; mutation: add unsubscribe_link to the resumable list → FAILS)", async () => {
    db.readConsentHistory.mockResolvedValue([row("revoked", "unsubscribe_link")]);
    expect(await resumeEmails(ctx, "ev_1", "asked")).toMatchObject({ ok: false, error: m["contact.email.changed"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("a thrown read or write is the plain failure line, logged (mutation: rethrow → the drawer crashes, FAILS)", async () => {
    db.readConsentHistory.mockRejectedValue(new Error("down"));
    expect(await resumeEmails(ctx, "ev_1", "asked")).toEqual({ ok: false, error: m["contact.email.failed"] });
  });
});
