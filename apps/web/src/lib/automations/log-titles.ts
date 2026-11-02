import type { AutomationLogSource, AutomationLogChannel, AutomationLogStatus } from "@bis/db";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** S-10 T9b: `SOURCE_TITLES` and `CHANNEL_WORDS` (English-only module
 *  constants, read once at load) are gone — T5 built `sourceTitle`/
 *  `channelWord` beside them but left the old pair in place "for the
 *  billing/plans/settings callers that still read them unchanged, outside
 *  this task's file consent" (the comment that used to sit here). This lane
 *  re-checked every reader (ratchet-scan.ts's own live scan, confirmed by
 *  grep): billing, plans and settings each have their OWN independent
 *  `*_STATUS_TREATMENTS` constants (billing-view.ts, plan-rows.ts), never
 *  imported from this file, and activity-table.tsx already reads
 *  `sourceTitle`/`channelWord`. Nothing was left reading the old pair. */
const SOURCE_KEY: Record<AutomationLogSource, MessageKey> = {
  reminders: "activity.source.reminders", followups: "activity.source.followups",
  review_request: "automations.review.title", no_show_nudge: "automations.noShow.title",
  sms_reminder: "automations.smsReminder.title", instant_reply: "automations.instantReply.title",
  weekly_report: "activity.source.weekly_report", concierge: "activity.source.concierge",
  voice: "activity.source.voice", appointment_confirm: "automations.appointmentConfirm.title",
  referral_ask: "automations.referral.title", reactivation: "automations.reactivation.title",
  quote_followup: "automations.quoteFollowup.title", textback: "activity.source.textback",
  document_request: "activity.source.documentRequest",
};
export function sourceTitle(source: AutomationLogSource, locale: Locale): string {
  return t(m, SOURCE_KEY[source], locale);
}

const CHANNEL_KEY: Record<AutomationLogChannel, MessageKey> = {
  sms: "activity.channel.sms", email: "activity.channel.email", ai: "activity.channel.ai",
};
export function channelWord(channel: AutomationLogChannel, locale: Locale): string {
  return t(m, CHANNEL_KEY[channel], locale);
}

const STATUS_KEY: Record<AutomationLogStatus, MessageKey> = {
  sent: "activity.status.sent", held: "activity.status.held",
  skipped: "activity.status.skipped", failed: "activity.status.failed",
};
export function statusWord(status: AutomationLogStatus, locale: Locale): string {
  return t(m, STATUS_KEY[status], locale);
}

/** Dot + chip only (DESIGN.md rule 3) — the label is `statusWord(status,
 *  locale)` above, never read off this object (S-10 T9b: the old `.label`
 *  field was an English-only module-level `m[...]` read nothing uses any
 *  more, confirmed by grep across every importer). Same treatment shape as
 *  the Calls page's OUTCOMES (calls/format.ts:34) so the two pills read as
 *  one system. */
export const STATUS_TREATMENTS: Record<AutomationLogStatus, { dot: string; chip: string }> = {
  sent: { dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  held: { dot: "bg-primary", chip: "border-primary/30 bg-primary/5 text-foreground" },
  skipped: { dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
  failed: { dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
};
