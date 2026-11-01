import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export type LeadAlertInput = {
  brand: EmailBrand;
  formName: string;
  answers: { label: string; value: string }[];
  /** Absolute, or null when the request carried no host. NEVER relative — a
   *  bare `/dashboard/...` is not a link in any email client, which is the
   *  defect this template replaces. */
  contactUrl: string | null;
  /** S-10 T8: `accounts.language ?? "en"` — one email, one language, subject
   *  through footer (spec §3.3). English when absent. */
  locale?: Locale;
};

export function leadAlertSubject(formName: string, locale: Locale = "en"): string {
  return t(m, "email.leadAlert.subject", locale, { formName });
}

/**
 * The email a client gets when a stranger fills in their form.
 *
 * It goes to the client's own inbox, so it can spend structure freely: there is
 * no deliverability cost to a table and a button here, unlike the message a
 * customer receives.
 *
 * Answers are escaped because they are attacker-supplied — a public form field
 * is the one place in this product where an untrusted stranger types text that
 * someone later opens in an email client.
 */
export function leadAlertEmail(input: LeadAlertInput): { html: string; text: string } {
  const locale = input.locale ?? "en";
  const rows = input.answers.map(({ label, value }) =>
    `<tr>
      <td style="padding:4px 12px 4px 0;color:#71717a;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");

  // The quoted form name wears curly entities in the HTML paragraph and
  // plain straight quotes in the text sentence, exactly as the hand-written
  // English did — the catalogue templates carry only the sentence shape,
  // never the quote style, so a translator cannot drift the two apart.
  const quotedHtml = `&ldquo;${escapeHtml(input.formName)}&rdquo;`;
  const quotedText = `"${input.formName}"`;
  const openContact = t(m, "email.alert.openContact", locale);

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(t(m, "email.leadAlert.heading", locale))}</p>
    <p style="margin:0 0 16px;color:#71717a;">${t(m, "email.leadAlert.fromFormHtml", locale, { quoted: quotedHtml })}</p>
    ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>` : ""}
    ${input.contactUrl ? button(input.brand, input.contactUrl, openContact) : ""}
  `);

  // Composed, never derived by stripping tags — this is the version a human
  // would have written, and it is what a text-only client shows.
  const text = [
    t(m, "email.leadAlert.fromFormText", locale, { quoted: quotedText }),
    "",
    ...input.answers.map((a) => `${a.label}: ${a.value}`),
    ...(input.contactUrl ? ["", `${openContact}: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}
