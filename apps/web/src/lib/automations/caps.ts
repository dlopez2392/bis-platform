/**
 * FIXED platform constants (danlo, 2026-09-06), and they apply to RECIPE
 * passes only — the reminder and follow-up passes are uncapped (see their doc
 * comments: a reminder is one-to-one with a booking the customer made, and a
 * daily cap would drop reminders for a busy client).
 *
 * The cap's job is a burst guard against a bug or a bulk status change, not
 * a plan feature: the morning band is twelve ticks wide, so an uncapped pass
 * on a busy client is a burst. No storage, no UI, no grant question. Skipped
 * rows are counted as `skippedCap` and left unstamped, so they are simply
 * due again next tick or next morning — and the counter is what tells us if
 * a real client ever hits this, at which point per-client configuration is a
 * decision with evidence behind it.
 */
export const AUTOMATION_TICK_CAP = 10;
export const AUTOMATION_DAILY_CAP = 25;
/** "A day" is a rolling 24h from the tick, counted from the pass's own stamp
 *  column — no ledger table, no timezone. */
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
