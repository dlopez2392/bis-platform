import { ensureCheckinTask, listCheckinsMissingTask } from "@bis/db";
import { taskTitle } from "@/lib/checkin/flow";
import { loggableError } from "@/lib/loggable-error";
import type { Pass, PassContext, PassCounters } from "../context";
import { reviewRequestPass } from "./review-request";

/**
 * The reconcile sweep for "not great" To-dos (F-072 PR 3; plan D3, PR 2's review). The answer page retries the To-do
 * a few times and a replay repairs it, but a customer who never taps again would leave an owner with no To-do and a
 * page that told the customer "We've let {name} know". Every tick this reads the not-great answers of the last
 * CHECKIN_SWEEP_WINDOW_MS that have no To-do (bounded by CHECKIN_SWEEP_LIMIT) and asks for each; the unique index
 * (tasks_review_checkin_once) makes a call that loses a race a no-op, so it can never make a second.
 *
 * The window is short on purpose: a To-do the owner deliberately removed is not remade for ever. It is long enough
 * for any outage the 15-minute tick survives.
 *
 * It runs INSIDE the `reviewRequests` key (not as a pass of its own: a new key would change the cron's JSON for
 * every account and add a node to the fan-out) and reports through that key, only when it did something, so an
 * account without the feature sees byte-identical counters. It never throws: a sweep that fails is counted, and the
 * pass's own counters are never lost to it.
 */
export const CHECKIN_SWEEP_WINDOW_MS = 48 * 60 * 60 * 1000;
export const CHECKIN_SWEEP_LIMIT = 25;

export async function sweepCheckinTasks(ctx: PassContext): Promise<PassCounters> {
  const out = { checkinTasksOpened: 0, checkinTasksFailed: 0 };
  let missing;
  try {
    missing = await listCheckinsMissingTask(ctx.db, new Date(ctx.now.getTime() - CHECKIN_SWEEP_WINDOW_MS).toISOString(), CHECKIN_SWEEP_LIMIT);
  } catch (e) {
    console.error(`check-in sweep: the not-great answers could not be read: ${loggableError(e)}`);
    return { checkinTasksFailed: 1 };
  }
  for (const checkin of missing) {
    try {
      const title = await taskTitle(ctx.db, checkin.accountId, checkin.contactId);
      const { created } = await ensureCheckinTask(
        ctx.db, checkin.accountId, checkin, { title, dueAt: ctx.now.toISOString() }, "checkin-sweep", "system");
      if (created) out.checkinTasksOpened++;
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
