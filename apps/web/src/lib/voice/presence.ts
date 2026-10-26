// apps/web/src/lib/voice/presence.ts
import { hasActiveCallSince, serviceDb } from "@bis/db";
import { listAnsweredCallStartsBetween } from "@/lib/reports/weekly-metrics";
import { localDayWindow } from "@/lib/dashboard/metrics";

export type VoicePresence = { onCall: boolean; weekCount: number };

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * The topbar Sofía presence indicator's data (DESIGN.md "AI presence" key
 * pattern: "● Sofía · on a call" / "✓ N calls handled in the last 7 days"). Read
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
 * `zone` (D-075): the ACCOUNT's own IANA zone, not UTC, so "the last 7 days"
 * are the account's own calendar days, as on its dashboard. The caller resolves the zone (same fallback
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

  // weekCount: calls ANSWERED over the last 7 LOCAL days, today included —
  // the same window the dashboard's "Calls answered" KPI counts
  // (`localDayWindow(now, zone, 7)`, dashboard page.tsx's `window7`), so the
  // topbar and the tile under it can never disagree. Read through the Monday
  // report's own answered-calls helper, so "handled" means what "calls
  // answered" means there: robocalls and the agency's test calls never count.
  // `countCallsSince` stays what the call CAPS read — those must count every
  // call that cost money, which is a different question.
  //
  // Until 2026-10-26 this counted from Monday 00:00 local (the calendar
  // week), which read "✓ 0 calls handled this week" on every Monday morning
  // beside a tile showing a week of answered calls. The owner chose the
  // rolling window that day. The name `weekCount` stays: it is a week's worth.
  const weekStart = localDayWindow(now, zone, 7).fromIso;

  const [onCall, answered] = await Promise.all([
    hasActiveCallSince(db, accountId, oneHourAgo),
    listAnsweredCallStartsBetween(db, accountId, weekStart, now.toISOString()),
  ]);
  return { onCall, weekCount: answered.length };
}
