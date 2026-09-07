import type { Pass } from "./context";
import { remindersPass } from "./passes/reminders";
import { followupsPass } from "./passes/followups";
import { reviewRequestPass } from "./passes/review-request";
import { noShowNudgePass } from "./passes/no-show-nudge";

/**
 * Every pass the cron tick runs, IN ORDER. Order is part of the contract:
 * the follow-up pass stamps `followup_sent_at` and the review-request pass
 * reads it in the same tick, which is what guarantees "how did it go?" on
 * day one and "would you leave a review?" on day two even when both become
 * eligible on the same morning.
 *
 * Adding a recipe = one line here plus its pass file. Nothing else.
 */
export const PASSES: readonly Pass[] = [remindersPass, followupsPass, reviewRequestPass, noShowNudgePass];
