import { listDueJobHolds } from "@bis/db";
import type { Pass } from "../context";
import { settleJobHold, type JobHoldOutcome } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/job-hold";

/**
 * F-046 part 1 (spec 6.5, D3): the backstop for a staff job's Undo hold. The agenda action settles its own
 * hold from after() once the window closes; when that process dies in the wait, the row's hold is still
 * unclaimed and this pass settles it on the next tick, through the same settleJobHold and this tick's own
 * email gate (`ctx.email`) and clock (`ctx.now`). cancelNotices' twin:
 *
 *   - It reads holds due JOB_HOLD_SWEEP_SLACK_MS ago or more, so a live after() normally settles its own row
 *     first; when both run, the claim (claimJobHold) lets exactly one through, and the other answers `lost`.
 *   - Nothing is abandoned: every row read is claimed (settled). Too old (the hold fell due more than
 *     JOB_NOTICE_MAX_AGE_MS ago) or already started: settled with no email (`too_late`, the settle's own rule).
 *   - A suppressed account (D-061) is NOT filtered out of the read (outbound-suppressed.test.ts's
 *     SETTLED_BY_THE_GATE): the email gate refuses its send and the settle still stamps the hold, so its
 *     reminders, which wait for the settle, are not left waiting for good.
 *   - JOB_HOLD_SWEEP_BATCH rows a tick, oldest first, and JOB_HOLD_BUDGET_MS of wall clock: once spent, no new
 *     row is started (one already started finishes) and the rest are counted `deferred` for the next tick.
 *     cron-coupling.test.ts counts the budget in the in-process tick's sum.
 *
 * Not an F-196 job: those drain only under CRON_FANOUT, which is off (plan correction 4). Runs right after
 * cancelNotices and before reminders, so in one in-process tick a confirmation precedes a reminder. Every
 * @bis/db export is dereferenced inside run(), never at module scope (the cron route test's bare mock throws
 * on a dereference).
 */
export const JOB_HOLD_SWEEP_SLACK_MS = 2 * 60 * 1000;
/** A settle is one claim, its events and at most one email; a deploy that killed many waits leaves the rest,
 *  oldest first, to the next tick. */
export const JOB_HOLD_SWEEP_BATCH = 25;
/** Wall-clock time, not `ctx.now`: the last point this pass STARTS a row. */
export const JOB_HOLD_BUDGET_MS = 10_000;

const COUNTER: Record<JobHoldOutcome, "sent" | "failed" | "quiet" | "tooLate" | "lost"> = {
  sent: "sent", failed: "failed", quiet: "quiet", too_late: "tooLate", lost: "lost",
};

export const jobHoldsPass: Pass = {
  key: "jobHolds",
  async run(ctx) {
    const c = { sent: 0, failed: 0, quiet: 0, tooLate: 0, lost: 0, deferred: 0 };
    const due = await listDueJobHolds(
      ctx.db, new Date(ctx.now.getTime() - JOB_HOLD_SWEEP_SLACK_MS).toISOString(), JOB_HOLD_SWEEP_BATCH,
    );
    const startedAt = Date.now();
    for (const [i, row] of due.entries()) {
      if (Date.now() - startedAt >= JOB_HOLD_BUDGET_MS) {
        c.deferred = due.length - i;
        console.error(`job holds: budget spent, ${c.deferred} row(s) left for the next tick`);
        break;
      }
      // settleJobHold never throws; a row that fails is that row's outcome, never the tick's.
      const outcome = await settleJobHold(row.accountId, row.bookingId, {
        db: ctx.db, origin: ctx.origin, now: () => ctx.now, send: (req) => ctx.email.send(req),
      });
      c[COUNTER[outcome]]++;
    }
    return c;
  },
};
