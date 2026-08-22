import { shell, button, escapeHtml, type EmailBrand } from "./shell";

const ROW_LABEL_STYLE =
  "padding:4px 12px 4px 0;color:#71717a;white-space:nowrap;vertical-align:top;";
const ROW_VALUE_STYLE = "padding:4px 0;vertical-align:top;";

export type BookingAlertInput = {
  brand: EmailBrand;
  /** Pre-formatted by the caller in the company's own zone. Templates format
   *  nothing — that discipline stays in one place, at the call site. */
  whenCompanyZone: string;
  /** Attacker-supplied: typed into a public booking page. */
  contactName: string;
  /** Attacker-supplied, same as `contactName`. */
  note: string | null;
  /** Absolute, or null when the request carried no host. NEVER relative. */
  contactUrl: string | null;
};

/**
 * The email a client gets when a stranger books time with them.
 *
 * Operator-facing, like `leadAlertEmail`: it lands in the client's own inbox,
 * so it can spend structure freely — a table row per fact and a button for
 * the contact link, with no deliverability cost the way a customer-facing
 * message would pay.
 */
export function bookingAlertEmail(input: BookingAlertInput): { html: string; text: string } {
  const noteRow = input.note
    ? `<tr>
        <td style="${ROW_LABEL_STYLE}">Note</td>
        <td style="${ROW_VALUE_STYLE}">${escapeHtml(input.note)}</td>
      </tr>`
    : "";

  const rows = `<tr>
      <td style="${ROW_LABEL_STYLE}">When</td>
      <td style="${ROW_VALUE_STYLE}">${escapeHtml(input.whenCompanyZone)}</td>
    </tr>
    <tr>
      <td style="${ROW_LABEL_STYLE}">Who</td>
      <td style="${ROW_VALUE_STYLE}">${escapeHtml(input.contactName)}</td>
    </tr>
    ${noteRow}`;

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">New booking</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(input.contactName)} booked a time with you.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>
    ${input.contactUrl ? button(input.brand, input.contactUrl, "Open this contact") : ""}
  `);

  // Composed, never derived by stripping tags — the version a human would
  // have written, and what a text-only client shows.
  const text = [
    `New booking from ${input.contactName}.`,
    "",
    `When: ${input.whenCompanyZone}`,
    `Who: ${input.contactName}`,
    ...(input.note ? [`Note: ${input.note}`] : []),
    ...(input.contactUrl ? ["", `Open this contact: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}

export type BookingConfirmationInput = {
  brand: EmailBrand;
  /** Pre-formatted in the booker's own zone. */
  whenBookerZone: string;
  /** Pre-formatted in the company's zone. Shown alongside the booker's line
   *  only when it reads differently — showing the same string twice tells a
   *  customer nothing they didn't already see. */
  whenCompanyZone: string;
  cancelUrl: string;
};

/**
 * The confirmation a booker gets after booking time with the company.
 *
 * Customer-facing, like `outboundEmail`: a small brand header, plain
 * paragraphs, and a plain cancel LINK rather than a button — cancelling
 * should be available, not promoted with the same visual weight as a
 * call-to-action.
 */
export function bookingConfirmationEmail(input: BookingConfirmationInput):
  { html: string; text: string } {
  const sameZone = input.whenBookerZone === input.whenCompanyZone;

  const whenHtml = sameZone
    ? `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>`
    : `<p style="margin:0 0 4px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
       <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(input.whenCompanyZone)} for us</p>`;

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">You're booked in.</p>
    ${whenHtml}
    <p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">Cancel this booking</a></p>
  `);

  const text = [
    "You're booked in.",
    "",
    input.whenBookerZone,
    ...(sameZone ? [] : [`${input.whenCompanyZone} for us`]),
    "",
    `Cancel this booking: ${input.cancelUrl}`,
  ].join("\n");

  return { html, text };
}

export type BookingReminderInput = {
  brand: EmailBrand;
  /** Pre-formatted in the booker's own zone. */
  whenBookerZone: string;
  cancelUrl: string;
};

/**
 * The reminder a booker gets ~24h before their booking.
 *
 * The confirmation minus the company-zone line and minus the "you're booked"
 * novelty: the booker already knows they're booked, so the subject here is
 * "this is tomorrow", not a repeat of the original news.
 */
export function bookingReminderEmail(input: BookingReminderInput):
  { html: string; text: string } {
  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">This is a reminder for your upcoming booking.</p>
    <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
    <p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">Cancel this booking</a></p>
  `);

  const text = [
    "This is a reminder for your upcoming booking.",
    "",
    input.whenBookerZone,
    "",
    `Cancel this booking: ${input.cancelUrl}`,
  ].join("\n");

  return { html, text };
}
