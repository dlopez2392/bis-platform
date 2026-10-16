import { describe, it, expect } from "vitest";
import type { ConsentHistoryRow } from "@bis/db";
import { emailViewOf, emailHowOf, EMAIL_RESUMABLE_METHODS } from "./email-view";

let n = 0;
const row = (action: string, method: string, at: string): ConsentHistoryRow =>
  ({ id: `ev_${++n}`, action, method, occurred_at: at, evidence: {}, note: null, actor_id: null }) as ConsentHistoryRow;

describe("emailViewOf — the Email row, as data (spec §6)", () => {
  it("no address is no_email; no rows is allowed with no newest id (mutation: treat no address as allowed → a Stop on nothing, FAILS)", () => {
    expect(emailViewOf([], false)).toEqual({ kind: "no_email" });
    expect(emailViewOf([], true)).toEqual({ kind: "allowed", newestId: null });
  });

  it("a customer's own stop (link, one-click) is stopped, 'unsubscribe link', and NOT resumable (choice 19; mutation: allow Resume over one_click → FAILS)", () => {
    for (const method of ["unsubscribe_link", "one_click"]) {
      const r = row("revoked", method, "2026-10-01T10:00:00Z");
      expect(emailViewOf([r], true)).toEqual({ kind: "stopped", eventId: r.id, since: r.occurred_at, how: { kind: "unsubscribe_link" }, canResume: false });
    }
  });

  it("a staff stop and a folded 0049 stop are stopped and resumable, each with its own how (G14; mutation: read backfill_0049 as 'staff' → the drawer says 'you recorded it' for the fold, FAILS)", () => {
    const s = row("revoked", "staff", "2026-10-01T10:00:00Z");
    expect(emailViewOf([s], true)).toMatchObject({ how: { kind: "staff" }, canResume: true });
    const f = row("revoked", "backfill_0049", "2026-09-01T10:00:00Z");
    expect(emailViewOf([f], true)).toMatchObject({ how: { kind: "backfill_0049" }, canResume: true });
  });

  it("a resubscribe after a stop is allowed again, carrying the newest id for the next Stop's compare-and-set (mutation: newestId null → a stale Stop is never refused, FAILS)", () => {
    const stop = row("revoked", "unsubscribe_link", "2026-10-01T10:00:00Z");
    const back = row("resubscribed", "unsubscribe_page", "2026-10-02T10:00:00Z");
    expect(emailViewOf([stop, back], true)).toEqual({ kind: "allowed", newestId: back.id });
  });

  it("the resumable list is exactly staff and backfill_0049 (mutation: add one_click → FAILS)", () => {
    expect([...EMAIL_RESUMABLE_METHODS].sort()).toEqual(["backfill_0049", "staff"]);
    expect(emailHowOf("unsubscribe_page")).toEqual({ kind: "unsubscribe_link" });
  });

  // S-06 part 1, plan G9: an emailed clear stop is its own how ("reply"), lifted only by its
  // Undo or the customer's own resubscribe — not in EMAIL_RESUMABLE_METHODS (mutation: fall
  // through to "staff" → FAILS).
  it("an inbound_email stop reads as 'reply', and is not staff-resumable", () => {
    expect(emailHowOf("inbound_email")).toEqual({ kind: "reply", expired: false });
    const r = row("revoked", "inbound_email", "2026-10-10T10:00:00Z");
    expect(emailViewOf([r], true, new Date("2026-10-10T10:00:00Z"))).toEqual({ kind: "stopped", eventId: r.id, since: r.occurred_at, how: { kind: "reply", expired: false }, canResume: false });
  });

  // S-06 part 1, fix round 1 (the execution note, binding on this task): the Email row shows
  // the expired explanation once an inbound_email stop is 7 DAYS OLD OR MORE — the boundary is
  // inclusive, matching 0082's own `occurred_at > now() - interval '7 days'` (strictly within is
  // still liftable, so AT exactly 7 days the window has already closed). Checked at the boundary
  // on both sides (mutation: shift the comparison to > 7 days → the exact boundary stays
  // unexpired, FAILS).
  it("the reply how's expired flag flips at exactly 7 days, not a moment before", () => {
    const since = "2026-10-01T00:00:00Z";
    const r = row("revoked", "inbound_email", since);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const justUnder = new Date(Date.parse(since) + sevenDaysMs - 1);
    const exactly = new Date(Date.parse(since) + sevenDaysMs);
    expect(emailViewOf([r], true, justUnder)).toMatchObject({ how: { kind: "reply", expired: false } });
    expect(emailViewOf([r], true, exactly)).toMatchObject({ how: { kind: "reply", expired: true } });
  });

  it("emailHowOf passes the expired flag through for 'reply' only; every other how ignores it (mutation: ignore the second argument → FAILS)", () => {
    expect(emailHowOf("inbound_email", true)).toEqual({ kind: "reply", expired: true });
    expect(emailHowOf("inbound_email", false)).toEqual({ kind: "reply", expired: false });
    expect(emailHowOf("staff", true)).toEqual({ kind: "staff" });
  });

  // D-016 item 4: a hard bounce or a complaint (0062's email_bounce/
  // email_complaint methods) is its own `how`, not a fallthrough to "staff
  // stopped" — the two read completely differently to the operator (a broken
  // address vs. a spam report), and neither is staff-resumable (mutation:
  // read either as "staff" → FAILS).
  it("a hard bounce and a complaint are their OWN how, and neither is resumable by staff (mutation: fold them into the staff default → FAILS)", () => {
    const bounced = row("revoked", "email_bounce", "2026-10-03T10:00:00Z");
    expect(emailViewOf([bounced], true)).toEqual({ kind: "stopped", eventId: bounced.id, since: bounced.occurred_at, how: { kind: "bounced" }, canResume: false });
    const complained = row("revoked", "email_complaint", "2026-10-03T10:00:00Z");
    expect(emailViewOf([complained], true)).toEqual({ kind: "stopped", eventId: complained.id, since: complained.occurred_at, how: { kind: "complained" }, canResume: false });
  });
});
