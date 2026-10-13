import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { gsmFoldVowels } from "@/lib/sms/segments";

type Lang = "en" | "es";

/**
 * The text reminder's LEAD: the appointment time, rendered by formatWhen in
 * the BOOKER's zone (the email reminder's rule), inside a fixed sentence the
 * operator cannot rearrange. `brandName` is the customer-facing name (the
 * due-row carries only that); a blank one drops the clause, never invents
 * a noun. Function replacement, not a plain string, for names with `$&`.
 *
 * S-09 C19: a Spanish date carries "sáb"/"mié"; folded so the text stays
 * GSM-7. English is never folded (plan deviation 10).
 */
export function smsReminderLead(brandName: string, whenText: string, language: Lang = "en"): string {
  const when = language === "es" ? gsmFoldVowels(whenText) : whenText;
  return brandName.trim()
    ? t(m, "automations.smsReminder.lead", language, { name: brandName, when })
    : t(m, "automations.smsReminder.leadNoName", language, { when });
}

/** The closing line sent when the operator has not written their own. */
export function defaultSmsReminderBody(language: Lang = "en"): string {
  return t(m, "automations.smsReminder.defaultBody", language);
}

/**
 * THE ONE composer for the text reminder: the lead, one space, the
 * operator's prose (or the default). The settings counter and the pass both
 * call this, so what the operator approves is what is billed.
 */
export function composeSmsReminder(brandName: string, whenText: string, body: string, language: Lang = "en"): string {
  return [smsReminderLead(brandName, whenText, language), body.trim()].filter(Boolean).join(" ");
}

/**
 * The instant the settings page previews with. FIXED, so the count the
 * operator sees does not drift day to day, and chosen at the widest common
 * width formatWhen produces (a two-digit day, a two-digit hour, a
 * three-letter zone: "Wed, Sep 30, 12:30 PM CDT") so the preview is not
 * optimistic. A real send renders the real time; ±2 characters.
 */
export const SMS_REMINDER_PREVIEW_INSTANT = new Date("2026-09-30T17:30:00Z");
