// apps/web/src/lib/voice/presence.ts
import { hasActiveCallSince, serviceDb } from "@bis/db";
import { listAnsweredCallStartsBetween } from "@/lib/reports/weekly-metrics";
import { lastWeekMonday, weekWindow } from "@/lib/reports/weekly-window";

export type VoicePresence = { onCall: boolean; weekCount: number };

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * The topbar Sofía presence indicator's data (DESIGN.md "AI presence" key
 * pattern: "● Sofía · on a call" / "✓ N calls handled this week"). Read
 * through the guarded `"use server"` action in the [accountId] segment
 * (dashboard/accounts/[accountId]/shell-actions.ts's getShellSnapshot) —
 * never from a layout, and never from this module directly: Task 5's
 * CORRECTED brief records why (Topbar mounts in the ROOT dashboard layout,
 * an ANCESTOR of [accountId], which never receives accountId through its
 * own params) — the same reasoning that keeps this one shared shell action
 * (this task's own P3 dedup) in that segment too.
 *
 * `db` and `now` are both passed in rather than read from ambient state, so
 * this stays testable with a mocked `@bis/db` — the same house shape
 * registry.test.ts uses (mock the specific @bis/db reads this function
 * calls, not a chainable fake supabase client). See presence.test.ts.
 *
 * `zone` (D-075): the ACCOUNT's own IANA zone, not UTC. Until 2026-10-08
 * "this week" rolled over at UTC midnight Monday regardless of the account's
 * own clock, so a Chicago client's week could already have turned over
 * locally — or not yet have, five hours either side of UTC's own boundary —
 * while the topbar disagreed. The caller resolves the zone (same fallback
 * discipline `resolveAccountZone`/`renderZone` use elsewhere); this function
 * only consumes it.
 */
export async function getVoicePresence(
  db: ReturnType<typeof serviceDb>, accountId: string, now: Date, zone: string,
): Promise<VoicePresence> {
  // onCall: "a `calls` row with `ended_at IS NULL AND started_at > now-1h`"
  // (brief's own predicate) — delegated to hasActiveCallSince
  // (packages/db/src/voice.ts) rather than a bespoke query here; see that
  // function's own doc comment for why the floor exists at all (an
  // unfinished row must age out, not pin the indicator on forever).
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS).toISOString();

  // weekCount: calls ANSWERED since the start of the current week, in the
  // ACCOUNT's own zone (D-075) — through the Monday report's own
  // answered-calls read, so "handled" means what the report's "calls
  // answered" means. Until 2026-10-06 this was `countCallsSince` (every
  // row), which counted robocalls and the agency's test calls as handled.
  // `countCallsSince` stays what the call CAPS read — those must count every
  // call that cost money, which is a different question.
  //
  // The boundary itself is `weekly-window.ts`'s own Monday-start convention,
  // re-derived rather than re-implemented: `lastWeekMonday(now, zone)` is the
  // Monday of the week that has just ENDED (last week's, if `now` sits
  // inside the current week), and `weekWindow(...).toIso` is local midnight
  // of the Monday SEVEN DAYS after that — i.e. the start of `now`'s own
  // current week. Sharing this with the Monday report's own window math is
  // what keeps the two from drifting into two different week-boundary rules.
  const weekStart = weekWindow(lastWeekMonday(now, zone), zone).toIso;

  const [onCall, answered] = await Promise.all([
    hasActiveCallSince(db, accountId, oneHourAgo),
    listAnsweredCallStartsBetween(db, accountId, weekStart, now.toISOString()),
  ]);
  return { onCall, weekCount: answered.length };
}
