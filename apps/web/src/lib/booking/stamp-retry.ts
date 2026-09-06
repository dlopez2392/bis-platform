/**
 * A bounded retry around the dedupe-stamp writes in the reminders cron
 * (`api/cron/reminders/route.ts`) — `stampReminderSent` and
 * `stampFollowupSent`.
 *
 * WHY THIS EXISTS, and why it is not a "nice to have". Both passes are
 * SEND-THEN-STAMP on purpose (see `stampReminderSent`'s doc comment in
 * `packages/db/src/booking.ts`): the stamp column is a dedupe marker, not a
 * record of an attempt, so stamping before a send that then failed would
 * silence that email forever. The accepted cost of that trade is a duplicate
 * when the send lands but the stamp does not.
 *
 * That cost was priced for a once-a-day cron. It changed shape on 2026-09-05
 * when the account moved to Vercel Pro and the job went back to every 15
 * minutes. The row stays in its query window for a SPAN, not for one tick:
 *
 *   reminders   `listDueReminders`' window is 75 minutes wide → 5-6 ticks
 *   follow-ups  the morning band in `followup-timing.ts` is 3 hours → ~12 ticks
 *
 * So one failed stamp is no longer "a duplicate". It is up to five more
 * reminders, or up to eleven more follow-ups, to the same customer, fifteen
 * minutes apart, until the window closes. The follow-up path is the worse of
 * the two by more than double.
 *
 * A stamp is a single-row `UPDATE ... WHERE id = $1` that has already been
 * reached over a working connection — the send immediately before it
 * succeeded. The failures it realistically sees are transient: a connection
 * reset, a brief PostgREST 5xx, a statement timeout under load. Those clear in
 * well under a second, which is what makes a short retry the right tool.
 *
 * WHAT IT DOES NOT DO. It does not make the duplicate impossible, and no
 * caller should describe it that way. If every attempt fails — a sustained
 * outage, or a write the database will keep refusing (a permissions change, a
 * constraint, a row that no longer exists) — the row is left unstamped and the
 * arithmetic above applies in full. Callers must still count and log that
 * outcome; see the call sites, which report it as `unstamped` in the cron's
 * response body.
 */

/**
 * The backoff schedule. Its LENGTH is the retry budget: attempts are
 * `length + 1`, because the first try is not a retry.
 *
 * Three attempts, ~0.9s of total sleep, and it grows rather than repeating —
 * an immediate re-fire would most likely land on the same blip that just
 * rejected. The ceiling matters as much as the floor: a tick pays this PER
 * failing row, and the cron shares one function invocation for both passes, so
 * an unbounded (or merely generous) schedule trades "a duplicate email" for "a
 * tick that never finishes". Anything that outlasts one second is an outage,
 * and no amount of retrying inside this tick helps with an outage.
 */
export const STAMP_RETRY_DELAYS_MS: readonly number[] = [200, 700];

export type StampOutcome =
  | { stamped: true; attempts: number }
  | { stamped: false; attempts: number; lastError: unknown };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `stamp` until it resolves or the budget in `STAMP_RETRY_DELAYS_MS` is
 * spent. Never throws — the caller decides what a permanent failure means, and
 * in the cron it means "count it, log it, and let the row repeat", never "abort
 * the tick and strand every row after this one".
 */
export async function stampWithRetry(stamp: () => Promise<void>): Promise<StampOutcome> {
  const maxAttempts = STAMP_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await stamp();
      return { stamped: true, attempts: attempt };
    } catch (e) {
      lastError = e;
      // Sleep only BETWEEN attempts — never after the last one, or every
      // give-up would pay for a wait nothing follows.
      const delay = STAMP_RETRY_DELAYS_MS[attempt - 1];
      if (delay !== undefined) await sleep(delay);
    }
  }

  return { stamped: false, attempts: maxAttempts, lastError };
}
