import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import { stripSubjectControlChars } from "./booking";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export type CheckinAlertInput = {
  /** `brand.name` is the brand display name, never `accounts.name`. */
  brand: EmailBrand;
  /** The customer's name as stored; null or blank reads "A customer". Typed by a stranger on a public page: escaped. */
  customerName: string | null;
  /** The job's day, formatted by the caller in the account's zone and language (templates format nothing); null names no day. */
  day: string | null;
  /** Absolute, or null when APP_ORIGIN is unset: then there is no button (never a relative path). */
  contactUrl: string | null;
  /** `accounts.language ?? "en"`: the owner's alerts follow the ACCOUNT's language, never the customer's. */
  locale?: Locale;
};

/**
 * The owner's alert when a customer answers "not great" on the after-the-job check-in (F-072). Operator mail like the
 * lead alert: no footer, goes to the booking calendar's alert list. It names the customer and the day and nothing
 * else (no address, no phone: both are one tap away on the record the button opens), and says the To-do exists,
 * because the To-do is the record and this is only the nudge.
 */
export function checkinAlertEmail(input: CheckinAlertInput): { subject: string; html: string; text: string } {
  const locale = input.locale ?? "en";
  const name = input.customerName?.trim() ?? "";
  const who = name || t(m, "email.checkinAlert.who", locale);
  const day = input.day?.trim() || null;
  const sentence = day
    ? t(m, "email.checkinAlert.body", locale, { who, day })
    : t(m, "email.checkinAlert.bodyNoDay", locale, { who });
  const todo = t(m, "email.checkinAlert.todo", locale);
  const open = t(m, "email.alert.openContact", locale);

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(sentence)}</p>
    <p style="margin:0 0 20px;color:#71717a;">${escapeHtml(todo)}</p>
    ${input.contactUrl ? button(input.brand, input.contactUrl, open) : ""}
  `);
  const text = [sentence, "", todo, ...(input.contactUrl ? ["", `${open}: ${input.contactUrl}`] : [])].join("\n");
  return {
    subject: t(m, "email.checkinAlert.subject", locale, { who: stripSubjectControlChars(who) }),
    html, text,
  };
}
