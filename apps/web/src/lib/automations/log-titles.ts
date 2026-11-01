import type { AutomationLogSource, AutomationLogChannel, AutomationLogStatus } from "@bis/db";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** A recipe KEY never reaches a screen (DESIGN.md, Voice). Each recipe card's
 *  own title is reused so the history and the settings page name the same
 *  thing the same way. (No count in this sentence on purpose: it said "four"
 *  and part B makes it eight, one task at a time.) */
export const SOURCE_TITLES: Record<AutomationLogSource, string> = {
  reminders: m["activity.source.reminders"],
  followups: m["activity.source.followups"],
  review_request: m["automations.review.title"],
  no_show_nudge: m["automations.noShow.title"],
  sms_reminder: m["automations.smsReminder.title"],
  instant_reply: m["automations.instantReply.title"],
  weekly_report: m["activity.source.weekly_report"],
  concierge: m["activity.source.concierge"],
  voice: m["activity.source.voice"],
  appointment_confirm: m["automations.appointmentConfirm.title"],
  referral_ask: m["automations.referral.title"],
  reactivation: m["automations.reactivation.title"],
  quote_followup: m["automations.quoteFollowup.title"],
  textback: m["activity.source.textback"],
  document_request: m["activity.source.documentRequest"],
};

export const CHANNEL_WORDS: Record<AutomationLogChannel, string> = {
  sms: m["activity.channel.sms"], email: m["activity.channel.email"], ai: m["activity.channel.ai"],
};

/** S-10 T5: `SOURCE_TITLES`/`CHANNEL_WORDS`/`STATUS_TREATMENTS.label` are English, built once at
 *  load — left exactly as they were (dot/chip and the English word, for the billing/plans/settings
 *  callers that still read them unchanged, outside this task's file consent). These three ask for
 *  the reader's own locale instead; activity-table.tsx and log-status-pill.tsx use them now. */
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

/** Dot + word (DESIGN.md rule 3), the same treatment shape as the Calls
 *  page's OUTCOMES (calls/format.ts:34) so the two pills read as one system. */
export const STATUS_TREATMENTS: Record<AutomationLogStatus, { label: string; dot: string; chip: string }> = {
  sent: { label: m["activity.status.sent"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  held: { label: m["activity.status.held"], dot: "bg-primary", chip: "border-primary/30 bg-primary/5 text-foreground" },
  skipped: { label: m["activity.status.skipped"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
  failed: { label: m["activity.status.failed"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
};
