import { listReleasableHolds, type AutomationLogSource } from "@bis/db";
import type { Pass } from "../context";
import { logSkipped, subjectOf, REASONS, type Releaser } from "../hold-or-send";
import { releaseReminder } from "./reminders";
import { releaseFollowup } from "./followups";
import { releaseReviewRequest } from "./review-request";
import { releaseNoShowNudge } from "./no-show-nudge";
import { releaseSmsReminder } from "./sms-reminder";
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
 */
export const RELEASE_BATCH = 200;

export const RELEASERS: Record<AutomationLogSource, Releaser | null> = {
  reminders: releaseReminder,
  followups: releaseFollowup,
  review_request: releaseReviewRequest,
  no_show_nudge: releaseNoShowNudge,
  sms_reminder: releaseSmsReminder,
  instant_reply: releaseInstantReply,
  weekly_report: null,
  concierge: null,
  voice: null,
};

export const releaseHeldPass: Pass = {
  key: "releaseHeld",
  async run(ctx) {
    const c = { examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0 };
    const rows = await listReleasableHolds(ctx.db, ctx.now.toISOString(), RELEASE_BATCH);
    for (const row of rows) {
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
