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
