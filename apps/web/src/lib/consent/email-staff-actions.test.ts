import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn(), readConsentHistory: vi.fn(), readConsentEvent: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { stopEmails, undoStopEmails, resumeEmails, recordInboundStop, undoInboundStop, type EmailContext } from "./email-staff-actions";
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

describe("recordInboundStop (spec 'The stop rule'; plan G3)", () => {
  it("appends revoked / inbound_email under if_allowed, sourced on the Resend id, with the phrase as evidence (mutation: guard 'none' → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "ev_1", prior: null });
    expect(await recordInboundStop(WRITER, { accountId: "a1", contactId: "c1", address: "ana@example.com", providerEmailId: "re_1", phrase: "STOP" }))
      .toEqual({ outcome: "stopped", eventId: "ev_1" });
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(WRITER, {
      accountId: "a1", channel: "email", address: "ana@example.com", action: "revoked", method: "inbound_email",
      contactId: "c1", actorId: null, sourceRef: "inbound_email:re_1", evidence: { inbound_email_id: "re_1", phrase: "STOP" },
    }, "if_allowed");
  });

  it("a retried delivery answers the same event; an already-stopped address answers already_stopped (mutation: map duplicate to already_stopped → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "duplicate", id: "ev_1" });
    expect((await recordInboundStop(WRITER, { accountId: "a1", contactId: "c1", address: "a@x.com", providerEmailId: "re_1", phrase: "STOP" })).outcome).toBe("stopped");
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "refused", prior: { id: "ev_0", action: "revoked", method: "unsubscribe_link", evidence: {} } });
    expect(await recordInboundStop(WRITER, { accountId: "a1", contactId: "c1", address: "a@x.com", providerEmailId: "re_2", phrase: "STOP" })).toEqual({ outcome: "already_stopped" });
  });

  it("a ledger error THROWS, so the route answers 503 (mutation: catch it → resolves, FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValueOnce(new Error("append_consent_event failed: down"));
    await expect(recordInboundStop(WRITER, { accountId: "a1", contactId: "c1", address: "a@x.com", providerEmailId: "re_3", phrase: "STOP" })).rejects.toThrow(/down/);
  });
});

describe("undoInboundStop", () => {
  it("writes resubscribed / staff_undo over that inbound stop, if it is still newest; any member may (mutation: require actor_id === userId → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: ctx.address, action: "revoked", method: "inbound_email", actor_id: null, occurred_at: new Date().toISOString() });
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "ev_2", prior: null });
    const r = await undoInboundStop(ctx, "ev_1");
    expect(r.ok).toBe(true);
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(WRITER, expect.objectContaining({ action: "resubscribed", method: "staff_undo", evidence: expect.objectContaining({ undoes: "ev_1" }) }), { ifNewest: "ev_1" });
  });

  it("refuses a row that is not an inbound_email stop at this address (mutation: drop the method check → a staff stop is undone here, FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: ctx.address, action: "revoked", method: "staff", actor_id: "u", occurred_at: new Date().toISOString() });
    expect((await undoInboundStop(ctx, "ev_1")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("a refusal past the 7-day window answers the expired explanation, TYPED, not the generic 'changed' line (owner ruling 2026-10-16; mutation: always answer 'changed' on refused → FAILS)", async () => {
    const old = new Date(ctx.now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: ctx.address, action: "revoked", method: "inbound_email", actor_id: null, occurred_at: old });
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: { id: "ev_1", action: "revoked", method: "inbound_email", evidence: {} } });
    // Fix round 1 item 4: a typed `expired` flag, not just the error string, so a caller (Task
    // 11's thread notice) branches on the FIELD and never string-matches a translatable message.
    expect(await undoInboundStop(ctx, "ev_1")).toMatchObject({ ok: false, expired: true, error: m["contact.email.replyExpiredExplain"] });
  });

  it("a refusal because the row is no longer newest answers the generic 'changed' line, not the expiry line (mutation: answer the expiry line whenever refused → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: ctx.address, action: "revoked", method: "inbound_email", actor_id: null, occurred_at: new Date().toISOString() });
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: { id: "ev_9", action: "resubscribed", method: "staff", evidence: {} } });
    expect(await undoInboundStop(ctx, "ev_1")).toMatchObject({ ok: false, error: m["contact.email.changed"] });
  });

  // Fix round 1 item 3: a stale click on the SAME method (another inbound_email stop landed and
  // is now newest) must not be read as "this row expired" just because the method matches —
  // only the SAME row id, still newest-but-expired, is the expiry case (mutation: drop the
  // `r.prior.id === eventId &&` check, reading any inbound_email prior as expired → FAILS).
  it("a stale click onto a DIFFERENT inbound_email row answers the generic 'changed' line, not the expiry line", async () => {
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: ctx.address, action: "revoked", method: "inbound_email", actor_id: null, occurred_at: new Date().toISOString() });
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: { id: "ev_3", action: "revoked", method: "inbound_email", evidence: {} } });
    const r = await undoInboundStop(ctx, "ev_1");
    expect(r).toMatchObject({ ok: false, error: m["contact.email.changed"] });
    expect(r).not.toHaveProperty("expired");
  });
});

/**
 * F-085 (spec §7.3): the email ledger is keyed by address, so under 0068 a
 * Technician's request client sees only part of an address's history. Every
 * history read here goes through the service client; the contact was already
 * proven by emailContextFor.
 */
describe("the history these controls read comes from the service client (F-085)", () => {
  it("a decision reads the address's history through ctx.writer, by address, never ctx.db (mutation: read it on ctx.db → FAILS)", async () => {
    await stopEmails(ctx, null);
    expect(db.readConsentHistory).toHaveBeenCalled();
    for (const call of db.readConsentHistory.mock.calls) {
      expect(call[0]).toBe(WRITER);
      expect(call.slice(1)).toEqual(["a1", "email", "ana@example.com"]);
    }
  });
});
