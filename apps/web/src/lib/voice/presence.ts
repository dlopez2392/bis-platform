// apps/web/src/lib/voice/presence.ts
import { countCallsSince, hasActiveCallSince, serviceDb } from "@bis/db";

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
 */
export async function getVoicePresence(
  db: ReturnType<typeof serviceDb>, accountId: string, now: Date,
): Promise<VoicePresence> {
  // onCall: "a `calls` row with `ended_at IS NULL AND started_at > now-1h`"
  // (brief's own predicate) — delegated to hasActiveCallSince
  // (packages/db/src/voice.ts) rather than a bespoke query here; see that
  // function's own doc comment for why the floor exists at all (an
  // unfinished row must age out, not pin the indicator on forever).
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS).toISOString();

  // weekCount: "calls with `started_at >= start of current week`" — UTC
  // week, per the brief ("account tz not required... label says 'this
  // week'"). Reuses the pre-existing countCallsSince (already exactly
  // `started_at >= sinceIso`) rather than a second bespoke query.
  const weekStart = startOfIsoWeekUtc(now).toISOString();

  const [onCall, weekCount] = await Promise.all([
    hasActiveCallSince(db, accountId, oneHourAgo),
    countCallsSince(db, accountId, weekStart),
  ]);
  return { onCall, weekCount };
}

/**
 * Midnight UTC on the Monday of `now`'s UTC week — ISO-8601's Monday-start
 * convention, chosen because no week-boundary convention already exists
 * anywhere else in this tree to match (booking-page.tsx's own `weekStart` is
 * a rolling 7-day window from "today", not a calendar week) and the label
 * ("this week") is generic enough that any single consistent choice
 * satisfies it. Pinned by presence.test.ts's own boundary cases — changing
 * the day this resets on is a deliberate, visible diff there, not silent
 * drift.
 *
 * Built off `getUTCDay()`, never a locale-aware API: Intl formats in the
 * SYSTEM zone (the repo's own recorded timezone-test lesson), and this must
 * be pinned to UTC regardless of the machine's zone or the account's.
 */
function startOfIsoWeekUtc(now: Date): Date {
  const day = now.getUTCDay(); // Sun=0 .. Sat=6
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}
