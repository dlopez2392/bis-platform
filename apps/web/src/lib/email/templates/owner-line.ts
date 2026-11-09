import { shell, escapeHtml, type EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** F-032 §4.2: three wrong PINs. To the person (forSelf) or to the account's Owner. One language end to end. */
export function ownerLineLockoutEmail(i: {
  brand: EmailBrand; locale: Locale; forSelf: boolean; personName: string | null; time: string; until: string;
}): { subject: string; text: string; html: string } {
  const subject = t(m, "ownerLine.email.subject", i.locale);
  const body = i.forSelf
    ? t(m, "ownerLine.email.self", i.locale, { time: i.time, until: i.until })
    : i.personName
      ? t(m, "ownerLine.email.owner", i.locale, { name: i.personName, time: i.time, until: i.until })
      : t(m, "ownerLine.email.ownerNoName", i.locale, { time: i.time, until: i.until });
  const tail = t(m, i.forSelf ? "ownerLine.email.selfTail" : "ownerLine.email.ownerTail", i.locale);
  const text = `${body}\n\n${tail}`;
  const html = shell(i.brand, `<p>${escapeHtml(body)}</p><p>${escapeHtml(tail)}</p>`);
  return { subject, text, html };
}
