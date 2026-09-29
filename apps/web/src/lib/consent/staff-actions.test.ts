import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  appendConsentEventGuarded: vi.fn(), readConsentHistory: vi.fn(), readConsentEvent: vi.fn(),
  completeTasksForConsentEvents: vi.fn(), reopenTasks: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { stopTexts, undoStopTexts, resumeTexts, confirmStop, notAStop, undoHoldDecision, UNDO_WINDOW_MS, type TextsContext } from "./staff-actions";
import { m } from "@/lib/messages";

const READER = { reader: true } as never;
const WRITER = { writer: true } as never;
const NOW = new Date("2026-10-06T20:00:00Z");
/** Thirty seconds before NOW: inside the Undo window. */
const FRESH = "2026-10-06T19:59:30Z";
const ctx: TextsContext = {
  db: READER, writer: WRITER, accountId: "a1", contactId: "c1", userId: "user_1", actorName: "Ana",
  address: "+19562921696", unconfirmed: false, now: NOW,
};
let n = 0;
const row = (action: string, method: string, evidence: Record<string, unknown> = {}, at = `2026-10-0${++n}T10:00:00Z`) =>
  ({ id: `ev_${n}`, action, method, occurred_at: at, evidence, note: null, actor_id: null });
const guardOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[2];
const eventOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[1];

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  n = 0;
  db.readConsentHistory.mockResolvedValue([]);
  db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "new_1", prior: null });
  db.completeTasksForConsentEvents.mockResolvedValue(["task_1"]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stopTexts", () => {
  it("writes revoked / staff through the SERVICE client, compare-and-set on the row the operator saw, with the actor and their name (plan G6, G14; mutation: guard 'none' → FAILS)", async () => {
    const r = await stopTexts(ctx, null);
    expect(db.appendConsentEventGuarded.mock.calls[0]![0]).toBe(WRITER);
    expect(eventOf()).toMatchObject({ action: "revoked", method: "staff", actorId: "user_1", address: "+19562921696", contactId: "c1", evidence: { actorName: "Ana" } });
    expect(guardOf()).toEqual({ ifNewest: null });
    expect(r).toMatchObject({ ok: true, undo: { kind: "stop", eventId: "new_1" } });
  });

  it("a stale click the function refuses (the newest row moved between the read and the write) answers the fresh view, never applied (mutation: treat refused as ok → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    const kw = row("revoked", "keyword", { keyword: "STOP" });
    db.readConsentHistory.mockResolvedValueOnce([]).mockResolvedValue([kw]);
    expect(await stopTexts(ctx, null)).toEqual({ ok: false, error: m["contact.texts.changed"], view: expect.objectContaining({ kind: "stopped", eventId: kw.id }) });
  });

  it("never stops over a customer's own STOP or over a hold, even when the client names that row's id — 0055's rule, mirrored here (review R3-C1; mutation: drop the state check → the write is attempted, FAILS)", async () => {
    const kw = row("revoked", "keyword", { keyword: "STOP" });
    db.readConsentHistory.mockResolvedValue([kw]);
    expect((await stopTexts(ctx, kw.id)).ok).toBe(false);
    const hold = row("held", "free_text");
    db.readConsentHistory.mockResolvedValue([hold]);
    expect((await stopTexts(ctx, hold.id)).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    // …and over a resubscribe it does write:
    const start = row("resubscribed", "start_keyword");
    db.readConsentHistory.mockResolvedValue([start]);
    expect((await stopTexts(ctx, start.id)).ok).toBe(true);
  });
});

describe("undoStopTexts", () => {
  it("undoes only a STAFF stop, compare-and-set on it (mutation: skip the method check → a keyword stop is undone, FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "keyword"), address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoStopTexts(ctx, "ev_kw")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    // Same probe, isolated from the actor/age checks (a keyword stop's
    // actor_id is never a staff id in practice, so the default `row()`
    // helper's actor_id: null would refuse this via `undoable` even with
    // the method check removed — that mutation must fail on ITS OWN merit).
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "keyword"), actor_id: "user_1", occurred_at: FRESH, address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoStopTexts(ctx, "ev_kw2")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff"), id: "ev_staff", actor_id: "user_1", occurred_at: FRESH, address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoStopTexts(ctx, "ev_staff")).ok).toBe(true);
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff_undo" });
    expect(guardOf()).toEqual({ ifNewest: "ev_staff" });
  });

  it("an Undo is the SAME person's, inside the window: another user's stop, or one older than UNDO_WINDOW_MS, is refused with the undo-expired line — otherwise Undo is a note-free Resume (review R3-I6; mutation: drop the actor check → FAILS; mutation: drop the age check → FAILS)", async () => {
    const base = { ...row("revoked", "staff"), id: "ev_staff", address: "+19562921696", channel: "sms", contact_id: "c1" };
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_2", occurred_at: FRESH });
    expect(await undoStopTexts(ctx, "ev_staff")).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    const old = new Date(NOW.getTime() - UNDO_WINDOW_MS).toISOString();
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_1", occurred_at: old });
    expect(await undoStopTexts(ctx, "ev_staff")).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("another number's row is refused, whatever its method (mutation: drop the address check → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff"), address: "+19565550000", channel: "sms", contact_id: "c9" });
    expect((await undoStopTexts(ctx, "ev_x")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    // Isolated from the actor/age checks (same reasoning as the method
    // probe above): a fresh row, this staff member's own, on the WRONG number.
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff"), actor_id: "user_1", occurred_at: FRESH, address: "+19565550000", channel: "sms", contact_id: "c9" });
    expect((await undoStopTexts(ctx, "ev_x2")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("resumeTexts (choice 19)", () => {
  it("refuses an empty note before anything is read (mutation: drop the note check → FAILS)", async () => {
    expect(await resumeTexts(ctx, "ev_1", "   ")).toEqual({ ok: false, error: m["contact.texts.resumeNoteRequired"] });
    expect(db.readConsentHistory).not.toHaveBeenCalled();
  });

  it("resumes a staff-recorded stop with the note, compare-and-set on it (mutation: omit the note → FAILS)", async () => {
    const stop = row("revoked", "staff");
    db.readConsentHistory.mockResolvedValue([stop]);
    expect((await resumeTexts(ctx, stop.id, " Asked on the phone ")).ok).toBe(true);
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff", note: "Asked on the phone" });
    expect(guardOf()).toEqual({ ifNewest: stop.id });
  });

  it("never resumes the customer's own stop, even if the client asks (mutation: drop the RESUMABLE check → FAILS)", async () => {
    const stop = row("revoked", "keyword");
    db.readConsentHistory.mockResolvedValue([stop]);
    expect((await resumeTexts(ctx, stop.id, "they asked")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("confirmStop / notAStop / their undo", () => {
  it("Confirm stop turns the hold into revoked / free_text carrying what they wrote, and completes the hold's To-dos (mutation: drop the evidence copy → FAILS)", async () => {
    const hold = row("held", "free_text", { phrase: "no me manden mensajes", excerpt: "Ya no me manden mensajes" });
    db.readConsentHistory.mockResolvedValue([hold]);
    const r = await confirmStop(ctx, hold.id);
    expect(eventOf()).toMatchObject({ action: "revoked", method: "free_text", evidence: { confirms: hold.id, phrase: "no me manden mensajes", excerpt: "Ya no me manden mensajes", actorName: "Ana" } });
    expect(guardOf()).toEqual({ ifNewest: hold.id });
    expect(db.completeTasksForConsentEvents).toHaveBeenCalledWith(READER, "a1", [hold.id], "user_1");
    expect(r).toMatchObject({ ok: true, undo: { kind: "decision", eventId: "new_1", reopenTaskIds: ["task_1"] } });
  });

  it("Confirm stop on something that is no longer the hold is refused (a STOP landed first; mutation: skip the hold check → FAILS)", async () => {
    const hold = row("held", "free_text");
    const stop = row("revoked", "keyword");
    db.readConsentHistory.mockResolvedValue([stop, hold]);
    expect((await confirmStop(ctx, hold.id)).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    // Isolated from the action check above: the newest row is STILL a hold,
    // but a DIFFERENT one (a second free-text sentence replaced it) — the id
    // check, not the action check, must be what refuses this (probe finding:
    // the case above alone never exercises `hold.id !== holdEventId`, since
    // its newest row is the STOP, not the hold, by occurred_at).
    const hold2 = row("held", "free_text");
    db.readConsentHistory.mockResolvedValue([hold, hold2]);
    expect((await confirmStop(ctx, hold.id)).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("Not a stop releases the hold (hold_released / staff) and completes its To-dos; a To-do failure does not undo the release (mutation: let it throw → FAILS)", async () => {
    const hold = row("held", "free_text", { excerpt: "wrong number" });
    db.readConsentHistory.mockResolvedValue([hold]);
    db.completeTasksForConsentEvents.mockRejectedValue(new Error("tasks down"));
    const r = await notAStop(ctx, hold.id);
    expect(eventOf()).toMatchObject({ action: "hold_released", method: "staff", evidence: { releases: hold.id, excerpt: "wrong number" } });
    expect(r).toMatchObject({ ok: true, undo: { kind: "decision", reopenTaskIds: [] } });
  });

  it("the Undo of either puts the hold back (held / staff_undo) with what they wrote, and reopens exactly the To-dos it closed (mutation: reopen none → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("hold_released", "staff", { excerpt: "wrong number" }), id: "ev_rel", actor_id: "user_1", occurred_at: FRESH, address: "+19562921696", channel: "sms", contact_id: "c1" });
    const r = await undoHoldDecision(ctx, "ev_rel", ["task_1"]);
    expect(eventOf()).toMatchObject({ action: "held", method: "staff_undo", evidence: { undoes: "ev_rel", excerpt: "wrong number" } });
    expect(guardOf()).toEqual({ ifNewest: "ev_rel" });
    expect(db.reopenTasks).toHaveBeenCalledWith(READER, "a1", ["task_1"], "user_1");
    expect(r.ok).toBe(true);
    // The write (the customer's number is back on hold) must land BEFORE the
    // To-dos reopen: reopening first would show staff an open To-do for a
    // hold the ledger hasn't recorded yet (review fix round 1, item 1).
    expect(db.appendConsentEventGuarded.mock.invocationCallOrder[0]).toBeLessThan(db.reopenTasks.mock.invocationCallOrder[0]!);
  });

  it("the Undo of a hold decision is bound the same way: another user's, or an old one, is refused (review R3-I6; mutation: drop the bound from undoHoldDecision → a confirmed stop is lifted back to a hold with no note, FAILS)", async () => {
    const base = { ...row("revoked", "free_text", { excerpt: "ya no me manden mensajes" }), id: "ev_conf", address: "+19562921696", channel: "sms", contact_id: "c1" };
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_2", occurred_at: FRESH });
    expect(await undoHoldDecision(ctx, "ev_conf", [])).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_1", occurred_at: "2026-10-06T19:00:00Z" });
    expect(await undoHoldDecision(ctx, "ev_conf", [])).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("an Undo pointed at anything but a hold decision is refused (mutation: accept any row → a keyword stop is 'undone' into a hold, FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "keyword"), address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoHoldDecision(ctx, "ev_kw", [])).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    // Isolated from the actor/age checks (same reasoning as the earlier
    // probes): this staff member's own, fresh row — but a plain keyword stop,
    // never a hold decision — must be refused by `isDecision`, not `undoable`.
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "keyword"), actor_id: "user_1", occurred_at: FRESH, address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoHoldDecision(ctx, "ev_kw2", [])).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("a write that throws is a plain failure line, logged (mutation: rethrow → FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValue(new Error("append_consent_event failed: timeout"));
    expect(await stopTexts(ctx, null)).toEqual({ ok: false, error: m["contact.texts.failed"] });
  });
});
