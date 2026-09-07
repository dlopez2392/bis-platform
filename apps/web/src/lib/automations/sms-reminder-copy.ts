import { m } from "@/lib/messages";

/**
 * The text reminder's LEAD: the appointment time, rendered by formatWhen in
 * the BOOKER's zone (the email reminder's rule), inside a fixed sentence the
 * operator cannot rearrange. `brandName` is the customer-facing name (the
 * due-row carries only that); a blank one drops the clause, never invents
 * a noun. Function replacement, not a plain string, for names with `$&`.
 */
export function smsReminderLead(brandName: string, whenText: string): string {
  const template = brandName.trim()
    ? m["automations.smsReminder.lead"].replace("{name}", () => brandName)
    : m["automations.smsReminder.leadNoName"];
  return template.replace("{when}", () => whenText);
}

/** The closing line sent when the operator has not written their own. */
export function defaultSmsReminderBody(): string {
  return m["automations.smsReminder.defaultBody"];
}

/**
 * THE ONE composer for the text reminder: the lead, one space, the
 * operator's prose (or the default). The settings counter and the pass both
 * call this, so what the operator approves is what is billed.
 */
export function composeSmsReminder(brandName: string, whenText: string, body: string): string {
  return [smsReminderLead(brandName, whenText), body.trim()].filter(Boolean).join(" ");
}

/**
 * The instant the settings page previews with. FIXED, so the count the
 * operator sees does not drift day to day, and chosen at the widest common
 * width formatWhen produces (a two-digit day, a two-digit hour, a
 * three-letter zone: "Wed, Sep 30, 12:30 PM CDT") so the preview is not
 * optimistic. A real send renders the real time; ±2 characters.
 */
export const SMS_REMINDER_PREVIEW_INSTANT = new Date("2026-09-30T17:30:00Z");
