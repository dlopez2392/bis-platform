import { shell, button, escapeHtml, type EmailBrand } from "./shell";

export type LeadAlertInput = {
  brand: EmailBrand;
  formName: string;
  answers: { label: string; value: string }[];
  /** Absolute, or null when the request carried no host. NEVER relative — a
   *  bare `/dashboard/...` is not a link in any email client, which is the
   *  defect this template replaces. */
  contactUrl: string | null;
};

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
  const rows = input.answers.map(({ label, value }) =>
    `<tr>
      <td style="padding:4px 12px 4px 0;color:#71717a;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">New lead</p>
    <p style="margin:0 0 16px;color:#71717a;">From your form &ldquo;${escapeHtml(input.formName)}&rdquo;.</p>
    ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>` : ""}
    ${input.contactUrl ? button(input.brand, input.contactUrl, "Open this contact") : ""}
  `);

  // Composed, never derived by stripping tags — this is the version a human
  // would have written, and it is what a text-only client shows.
  const text = [
    `New lead from your form "${input.formName}".`,
    "",
    ...input.answers.map((a) => `${a.label}: ${a.value}`),
    ...(input.contactUrl ? ["", `Open this contact: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}
