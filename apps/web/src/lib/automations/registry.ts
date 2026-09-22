import type { Pass } from "./context";
import { releaseHeldPass } from "./passes/release-held";
import { remindersPass } from "./passes/reminders";
import { followupsPass } from "./passes/followups";
import { reviewRequestPass } from "./passes/review-request";
import { noShowNudgePass } from "./passes/no-show-nudge";
import { smsReminderPass } from "./passes/sms-reminder";
import { appointmentConfirmPass } from "./passes/appointment-confirm";
import { siteTrafficPass } from "./passes/site-traffic";
import { weeklyClientReportPass } from "./passes/weekly-report";
import { weeklyAgencyReportPass } from "./passes/weekly-agency-report";

/**
 * Every pass the cron tick runs, IN ORDER. Order is part of the contract:
 * the release pass runs first: a held subject is sent (and stamped) before
 * its own pass's due-list runs, so the same tick cannot send it twice. The
 * follow-up pass stamps `followup_sent_at` and the review-request pass
 * reads it in the same tick, which is what guarantees "how did it go?" on
 * day one and "would you leave a review?" on day two even when both become
 * eligible on the same morning.
 *
 * The SMS reminder reads nothing the others write. The confirmation ask
 * (part B) reads nothing the other booking passes write and writes only its
 * own stamp, so it sits WITH them rather than between them: after the text
 * reminder, before the site-traffic pull. The site-traffic pull
 * runs after both — it touches no booking state and sends nothing. The weekly
 * reports run last of all: the client pass first (spec, "Recorded
 * consequence" — the roll-up fires on its own gate, not after all client
 * emails, so this order is a reading convenience, not a dependency), then
 * the agency roll-up, which reads every account's own numbers through the
 * same `weeklyMetrics` the client pass just used.
 * Adding a recipe = one line here plus its pass file. Nothing else.
 */
export const PASSES: readonly Pass[] = [releaseHeldPass, remindersPass, followupsPass, reviewRequestPass, noShowNudgePass, smsReminderPass, appointmentConfirmPass, siteTrafficPass, weeklyClientReportPass, weeklyAgencyReportPass];
