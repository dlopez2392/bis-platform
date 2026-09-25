import { listReleasableHolds, type AutomationLogSource } from "@bis/db";
import type { Pass } from "../context";
import { logSkipped, subjectOf, REASONS, type Releaser } from "../hold-or-send";
import { releaseReminder } from "./reminders";
import { releaseFollowup } from "./followups";
import { releaseReviewRequest } from "./review-request";
import { releaseNoShowNudge } from "./no-show-nudge";
import { releaseSmsReminder } from "./sms-reminder";
import { releaseAppointmentConfirm } from "./appointment-confirm";
import { releaseReferralAsk } from "./referral-ask";
import { releaseReactivation } from "./reactivation";
import { releaseQuoteFollowup } from "./quote-followup";
import { releaseInstantReply } from "../instant-reply";

/**
 * The queue's consumer (spec §1, amendment 1). FIRST in the registry on
 * every tick: every held row whose `held_until` has passed is handed back
 * to its source, which re-reads the subject, re-checks it, and sends
 * through the same per-row path the normal tick uses — so the held row
 * flips to `sent`, `skipped` or `failed` by the same write the pass would
 * have made, or is re-held if the agency lengthened the window.
 *
 * Runs BEFORE the domain passes so a subject released here is stamped
 * before its own pass's due-list runs; the sequential harness is what makes
 * a double send impossible in the same tick.
 *
 * A row a releaser leaves untouched (a band-gated pass whose SMS cooldown
 * is still active, say) keeps its past `held_until` and is examined again
 * next tick — bounded by RELEASE_BATCH and by the row's own fate. A source
 * that can never be held (the AI rows, the weekly report) has no releaser;
 * such a row can only exist by a bug and is skipped out of the queue with
 * a reason rather than examined forever.
 *
 * A NAMING QUIRK, not a bug: a released email reminder with no email on
 * file writes a `skipped` row (the row a business owner reads on the
 * Activity page), but the reminders pass counts a missing email `failed` —
 * its own historic counter rule, unchanged here. So `RELEASERS.reminders`
 * can return `"failed"` for a row this tick's Activity page shows as
 * `skipped`. That mismatch is between the releaser's return value and its
 * OWN pass's counter convention, not something this pass introduces — the
 * counters below are not renamed to paper over it.
 *
 * The per-tick BURST CAP other recipe passes enforce (`AUTOMATION_TICK_CAP`,
 * caps.ts) is deliberately NOT re-applied here: each release calls its
 * source's `processX` with a single-row array, so that pass's own
 * `attemptsThisTick` starts fresh at 0 for every row released this tick.
 * `AUTOMATION_DAILY_CAP` — the per-account, per-day ceiling — is what bounds
 * a bulk release; the tick cap exists to spread a NORMAL day's sends across
 * ticks, not to limit how many already-decided releases one tick can drain.
 */
export const RELEASE_BATCH = 200;

/**
 * Wall-clock budget for one tick's worth of releasing, in milliseconds —
 * real elapsed time this invocation has spent, NOT `ctx.now` (the tick's
 * own instant every pass reads its "now" from). A shared window end (say,
 * quiet hours ending 08:00 for a whole account list) can make every held
 * row releasable in the same tick; each row costs a re-read, a settings
 * read, a provider send and two writes, and this pass is FIRST in the
 * registry, so an unbounded drain here would starve reminders, follow-ups,
 * review requests and the weekly reports that run after it. The queue is
 * ordered by `held_until` ascending (`listReleasableHolds`), so stopping
 * partway through is safe: the untouched rows keep their past `held_until`
 * and are the first examined again on the next tick, 15 minutes later. The
 * ceiling this budget sits under is the cron route's own `maxDuration`
 * (`api/cron/reminders/route.ts`, 300s) — `cron-coupling.test.ts` pins the
 * two together, so raising this value without raising that one is caught.
 */
export const RELEASE_BUDGET_MS = 60_000;

export const RELEASERS: Record<AutomationLogSource, Releaser | null> = {
  reminders: releaseReminder,
  followups: releaseFollowup,
  review_request: releaseReviewRequest,
  no_show_nudge: releaseNoShowNudge,
  sms_reminder: releaseSmsReminder,
  instant_reply: releaseInstantReply,
  appointment_confirm: releaseAppointmentConfirm,
  referral_ask: releaseReferralAsk,
  reactivation: releaseReactivation,
  quote_followup: releaseQuoteFollowup,
  weekly_report: null,
  concierge: null,
  voice: null,
};

export const releaseHeldPass: Pass = {
  key: "releaseHeld",
  async run(ctx) {
    const c = { examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0, deferred: 0 };
    const rows = await listReleasableHolds(ctx.db, ctx.now.toISOString(), RELEASE_BATCH);
    const startedAt = Date.now();
    for (const row of rows) {
      if (Date.now() - startedAt >= RELEASE_BUDGET_MS) {
        c.deferred = rows.length - c.examined;
        console.error(`release: budget spent after ${c.examined} row(s), ${c.deferred} deferred to the next tick`);
        break;
      }
      c.examined++;
      try {
        const releaser = RELEASERS[row.source];
        if (!releaser) {
          await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
          c.skipped++;
          continue;
        }
        c[await releaser(ctx, row)]++;
      } catch (e) {
        c.errored++;
        console.error(`release of ${row.source} ${row.subject_key} failed outright: ${String(e)}`);
      }
    }
    return c;
  },
};
