import { ensureCheckinTask, listCheckinsMissingTask } from "@bis/db";
import { alertOwnerOfNotGreat, type CheckinAlertOutcome } from "@/lib/checkin/alert";
import { taskTitle } from "@/lib/checkin/flow";
import { loggableError } from "@/lib/loggable-error";
import type { Pass, PassContext, PassCounters } from "../context";
import { reviewRequestPass } from "./review-request";

/**
 * The reconcile sweep for "not great" To-dos (F-072 PR 3; plan D3, PR 2's review). The answer page retries the To-do
 * a few times and a replay repairs it, but a customer who never taps again would leave an owner with no To-do and a
 * page that told the customer "We've let {name} know". Every tick this reads the not-great answers of the last
 * CHECKIN_SWEEP_WINDOW_MS that have no To-do (the filter is in the query, so CHECKIN_SWEEP_LIMIT bounds only rows
 * that still need one; a full page is counted `checkinSweepPageFull`) and asks for each; the unique index
 * (tasks_review_checkin_once) makes a call that loses a race a no-op, so it can never make a second.
 *
 * The window is short on purpose: a To-do the owner deliberately removed is not remade for ever. It is long enough
 * for any outage the 15-minute tick survives.
 *
 * A To-do the sweep itself creates also emails the booking calendar's alert list (checkin/alert.ts, owner decision
 * 2026-11-17), exactly as the answer page does for one it creates, and for the same reason: `created` is true once.
 * Counted `checkinAlertsSent`, `checkinAlertsNoRecipients` and `checkinAlertsFailed` (none of them reddens the
 * heartbeat: the To-do is the record, the email is the nudge).
 *
 * It runs INSIDE the `reviewRequests` key (not as a pass of its own: a new key would change the cron's JSON for
 * every account and add a node to the fan-out) and reports through that key, only when it did something, so an
 * account without the feature sees byte-identical counters. It never throws: a sweep that fails is counted, and the
 * pass's own counters are never lost to it.
 */
export const CHECKIN_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000;
export const CHECKIN_SWEEP_LIMIT = 25;

export async function sweepCheckinTasks(ctx: PassContext): Promise<PassCounters> {
  const out = {
    checkinTasksOpened: 0, checkinTasksFailed: 0, checkinSweepPageFull: 0,
    checkinAlertsSent: 0, checkinAlertsNoRecipients: 0, checkinAlertsFailed: 0,
  };
  let missing;
  try {
    missing = await listCheckinsMissingTask(ctx.db, new Date(ctx.now.getTime() - CHECKIN_SWEEP_WINDOW_MS).toISOString(), CHECKIN_SWEEP_LIMIT);
  } catch (e) {
    console.error(`check-in sweep: the not-great answers could not be read: ${loggableError(e)}`);
    return { checkinTasksFailed: 1 };
  }
  // A full page means there may be more task-missing rows than this tick looked at (the next tick takes them).
  if (missing.length >= CHECKIN_SWEEP_LIMIT) out.checkinSweepPageFull = 1;
  for (const checkin of missing) {
    try {
      const title = await taskTitle(ctx.db, checkin.accountId, checkin.contactId);
      const { created } = await ensureCheckinTask(
        ctx.db, checkin.accountId, checkin, { title, dueAt: ctx.now.toISOString() }, "checkin-sweep", "system");
      if (created) {
        out.checkinTasksOpened++;
        // The owner's email, ONLY for a To-do THIS call made (a To-do the page already made was mailed then). It goes
        // through the tick's own gate; it never throws, and a failure never undoes the To-do.
        let outcome: CheckinAlertOutcome;
        try {
          outcome = await alertOwnerOfNotGreat(ctx.db, checkin, { send: (req) => ctx.email.send(req), now: ctx.now });
        } catch (e) {
          console.error(`check-in sweep: the owner alert for check-in ${checkin.id} (account ${checkin.accountId}) threw (the To-do exists): ${loggableError(e)}`);
          outcome = { sent: 0, failed: 1 };
        }
        if (outcome.skipped === "no_recipients") out.checkinAlertsNoRecipients++;
        else if (outcome.sent > 0) out.checkinAlertsSent++;
        else out.checkinAlertsFailed++;
      }
    } catch (e) {
      out.checkinTasksFailed++;
      console.error(`check-in sweep: the To-do for check-in ${checkin.id} (account ${checkin.accountId}) was not made, the next tick retries: ${loggableError(e)}`);
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n > 0));
}

/**
 * The review-request pass and then the sweep, under the review request's own key. The sweep runs even when the pass
 * fails outright (they read different things), and the failure still reaches the harness, which records it as
 * `{ errored: 1 }` and goes on to the next pass.
 */
export const reviewRequestsPass: Pass = {
  key: reviewRequestPass.key,
  /** A check-in that cannot be sent for want of a link, or a To-do the sweep cannot make, is a deployment or database
   *  fault nobody is watching: make the heartbeat red so opsWatch can say so. Counters are unchanged. */
  beatFailure: (c) => {
    if ((c.skippedNoLink ?? 0) > 0) return `review check-ins are not sent: no link can be made (${c.skippedNoLink}); APP_ORIGIN or CONSENT_TOKEN_SECRET is unset or unusable`;
    if ((c.checkinTasksFailed ?? 0) > 0) return `the check-in sweep could not make ${c.checkinTasksFailed} To-do(s)`;
    return null;
  },
  async run(ctx) {
    let counters: PassCounters | undefined;
    let failure: unknown;
    try {
      counters = await reviewRequestPass.run(ctx);
    } catch (e) {
      failure = e;
    }
    const swept = await sweepCheckinTasks(ctx);
    if (counters === undefined) throw failure;
    return { ...counters, ...swept };
  },
};
