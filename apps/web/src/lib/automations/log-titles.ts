import type { AutomationLogSource, AutomationLogChannel, AutomationLogStatus } from "@bis/db";
import { m } from "@/lib/messages";

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
};

export const CHANNEL_WORDS: Record<AutomationLogChannel, string> = {
  sms: m["activity.channel.sms"], email: m["activity.channel.email"], ai: m["activity.channel.ai"],
};

/** Dot + word (DESIGN.md rule 3), the same treatment shape as the Calls
 *  page's OUTCOMES (calls/format.ts:34) so the two pills read as one system. */
export const STATUS_TREATMENTS: Record<AutomationLogStatus, { label: string; dot: string; chip: string }> = {
  sent: { label: m["activity.status.sent"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  held: { label: m["activity.status.held"], dot: "bg-primary", chip: "border-primary/30 bg-primary/5 text-foreground" },
  skipped: { label: m["activity.status.skipped"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
  failed: { label: m["activity.status.failed"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
};
