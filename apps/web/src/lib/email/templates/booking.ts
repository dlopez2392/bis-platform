import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import type { PublicLocale } from "@/lib/forms/public-strings";

/**
 * The confirmation is the one booking email a stranger reads, so it is the
 * one that speaks their language. The alert and the reminder stay English:
 * the alert is for the operator, and the reminder runs from a cron that has
 * no booker language on the row yet (a `bookings.locale` column is the
 * recorded follow-up).
 */
const CONFIRMATION_COPY = {
  en: {
    subject: "You're booked in",
    title: "You're booked in.",
    forUs: (when: string) => `${when} for us`,
    join: "Join your video meeting",
    cancel: "Cancel this booking",
  },
  es: {
    subject: "Tu cita quedó agendada",
    title: "Tu cita quedó agendada.",
    forUs: (when: string) => `${when} para nosotros`,
    join: "Unirse a la videollamada",
    cancel: "Cancelar esta cita",
  },
} as const;

export function bookingConfirmationSubject(locale: PublicLocale = "en"): string {
  return CONFIRMATION_COPY[locale].subject;
}

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
  /** The booker's language; English when absent. Both when-strings are
   *  expected to have been formatted in the same language by the caller. */
  locale?: PublicLocale;
  /** Pre-formatted in the booker's own zone. */
  whenBookerZone: string;
  /** Pre-formatted in the company's zone. Shown alongside the booker's line
   *  only when it reads differently — showing the same string twice tells a
   *  customer nothing they didn't already see. */
  whenCompanyZone: string;
  cancelUrl: string;
  /** Absolute video-room URL, present only when the calendar's
   *  `meeting_type` is `"video"` AND the meeting provider minted a room
   *  successfully — a provider that is unconfigured or that throws leaves
   *  this `undefined` (see `b/[publicId]/actions.ts`). Same empty-vs-absent
   *  discipline as `cancelUrl`: omitted entirely, never a link to nowhere. */
  meetingUrl?: string;
};

/**
 * The confirmation a booker gets after booking time with the company.
 *
 * Customer-facing, like `outboundEmail`: a small brand header, plain
 * paragraphs, and a plain cancel LINK rather than a button — cancelling
 * should be available, not promoted with the same visual weight as a
 * call-to-action. The video link, when present, is the opposite call: it IS
 * the meeting, so it gets the `button()` treatment — more visual weight than
 * the cancel link, not less.
 */
export function bookingConfirmationEmail(input: BookingConfirmationInput):
  { html: string; text: string } {
  const copy = CONFIRMATION_COPY[input.locale ?? "en"];
  const sameZone = input.whenBookerZone === input.whenCompanyZone;

  const whenHtml = sameZone
    ? `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>`
    : `<p style="margin:0 0 4px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
       <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(copy.forUs(input.whenCompanyZone))}</p>`;

  const meetingHtml = input.meetingUrl
    ? `<p style="margin:0 0 16px;">${button(input.brand, input.meetingUrl, copy.join)}</p>`
    : "";

  // `cancelUrl` arrives "" when the triggering request carried no host
  // header (`originFrom` returns null — see `b/[publicId]/actions.ts`). An
  // anchor built on an empty href is not a broken link in most clients, it's
  // a link back to the CURRENT page — worse than no link at all in a sent
  // email. Omitted entirely rather than rendered disabled, matching how
  // `booking-page.tsx` already treats the same empty string in-app.
  const cancelHtml = input.cancelUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">${escapeHtml(copy.cancel)}</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(copy.title)}</p>
    ${whenHtml}
    ${meetingHtml}
    ${cancelHtml}
  `);

  const text = [
    copy.title,
    "",
    input.whenBookerZone,
    ...(sameZone ? [] : [copy.forUs(input.whenCompanyZone)]),
    ...(input.meetingUrl ? ["", `${copy.join}: ${input.meetingUrl}`] : []),
    ...(input.cancelUrl ? ["", `${copy.cancel}: ${input.cancelUrl}`] : []),
  ].join("\n");

  return { html, text };
}

export type BookingRescheduledInput = {
  brand: EmailBrand;
  /** Pre-formatted in the booker's own zone — the NEW time, never the old. */
  whenBookerZone: string;
  /** Pre-formatted in the company's zone; same show-only-when-different
   *  discipline as `BookingConfirmationInput.whenCompanyZone`. */
  whenCompanyZone: string;
  /** The NEW booking row's cancel link — the old row is cancelled, so its
   *  token resolves to nothing worth mailing again. */
  cancelUrl: string;
  /** The NEW room's url, same present-only-when-minted discipline as
   *  `BookingConfirmationInput.meetingUrl`. When present, the copy also says
   *  it REPLACES the earlier confirmation's link — the whole reason this
   *  template exists: a same-day video reschedule otherwise leaves the
   *  customer holding a link to a room nobody will be in. */
  meetingUrl?: string;
};

/**
 * The email a booker gets after their booking is MOVED (today: by phone,
 * through the voice assistant's reschedule tool).
 *
 * The confirmation reshaped for changed news: "moved", not "booked" — the
 * customer already had a confirmation, so repeating its copy verbatim would
 * read as a duplicate and bury the one fact that matters, the new time. Same
 * customer-facing restraint and the same link-weight calls as
 * `bookingConfirmationEmail`: video link as a button, cancel as a plain link,
 * both omitted entirely rather than rendered empty.
 */
export function bookingRescheduledEmail(input: BookingRescheduledInput):
  { html: string; text: string } {
  const sameZone = input.whenBookerZone === input.whenCompanyZone;

  const whenHtml = sameZone
    ? `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>`
    : `<p style="margin:0 0 4px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
       <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(input.whenCompanyZone)} for us</p>`;

  const meetingHtml = input.meetingUrl
    ? `<p style="margin:0 0 4px;">${button(input.brand, input.meetingUrl, "Join your video meeting")}</p>
       <p style="margin:0 0 16px;color:#71717a;">This link replaces the one from your earlier confirmation.</p>`
    : "";

  // Same reasoning as `bookingConfirmationEmail`'s `cancelHtml`: an empty
  // `cancelUrl` gets no anchor at all, never one pointing nowhere.
  const cancelHtml = input.cancelUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">Cancel this booking</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">Your booking has been moved.</p>
    ${whenHtml}
    ${meetingHtml}
    ${cancelHtml}
  `);

  const text = [
    "Your booking has been moved.",
    "",
    input.whenBookerZone,
    ...(sameZone ? [] : [`${input.whenCompanyZone} for us`]),
    ...(input.meetingUrl
      ? ["", `Join your video meeting: ${input.meetingUrl}`,
        "This link replaces the one from your earlier confirmation."]
      : []),
    ...(input.cancelUrl ? ["", `Cancel this booking: ${input.cancelUrl}`] : []),
  ].join("\n");

  return { html, text };
}

export type BookingReminderInput = {
  brand: EmailBrand;
  /** Pre-formatted in the booker's own zone. */
  whenBookerZone: string;
  cancelUrl: string;
  /** Same discipline as `BookingConfirmationInput.meetingUrl`: present only
   *  when the calendar is `"video"` AND the room still exists at reminder
   *  time — omitted entirely, never a link to nowhere. */
  meetingUrl?: string;
};

/**
 * The reminder a booker gets ~24h before their booking.
 *
 * The confirmation minus the company-zone line and minus the "you're booked"
 * novelty: the booker already knows they're booked, so the subject here is
 * "this is tomorrow", not a repeat of the original news. The video link, when
 * present, gets the same `button()` treatment as the confirmation's — it IS
 * the meeting, so it outweighs the plain cancel link here too.
 */
export function bookingReminderEmail(input: BookingReminderInput):
  { html: string; text: string } {
  const meetingHtml = input.meetingUrl
    ? `<p style="margin:0 0 16px;">${button(input.brand, input.meetingUrl, "Join your video meeting")}</p>`
    : "";

  // Same reasoning as `bookingConfirmationEmail`'s `cancelHtml`: an empty
  // `cancelUrl` gets no anchor at all, never one pointing nowhere.
  const cancelHtml = input.cancelUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">Cancel this booking</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">This is a reminder for your upcoming booking.</p>
    <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
    ${meetingHtml}
    ${cancelHtml}
  `);

  const text = [
    "This is a reminder for your upcoming booking.",
    "",
    input.whenBookerZone,
    ...(input.meetingUrl ? ["", `Join your video meeting: ${input.meetingUrl}`] : []),
    ...(input.cancelUrl ? ["", `Cancel this booking: ${input.cancelUrl}`] : []),
  ].join("\n");

  return { html, text };
}

/** Same subject-injection guard the public booking and cancel actions keep:
 *  a customer-supplied name must never be able to start a new header line. */
function stripSubjectControlChars(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ");
}

export type BookingPhoneChangeAlertInput = {
  brand: EmailBrand;
  kind: "cancelled" | "moved";
  /** The booking's time BEFORE the change, pre-formatted in the company zone. */
  whenCompanyZone: string;
  /** The new time, pre-formatted in the company zone. `moved` only. */
  newWhenCompanyZone?: string;
  /** From the contact row — customer-supplied (a booking page or a call). */
  contactName: string;
  /** The number the call came from, or null when it was withheld. */
  callerNumber: string | null;
  /** Absolute, or null. NEVER relative. */
  contactUrl: string | null;
};

/**
 * The email a client gets when the phone receptionist cancels or moves one of
 * their bookings on a call.
 *
 * Operator-facing, like `bookingAlertEmail`, and English like every staff
 * alert. It returns its own subject because the subject carries the
 * customer-supplied name and has to be made header-safe in one place.
 */
export function bookingPhoneChangeAlertEmail(input: BookingPhoneChangeAlertInput):
  { subject: string; html: string; text: string } {
  const moved = input.kind === "moved";
  const newWhen = input.newWhenCompanyZone ?? "";
  const heading = moved ? "Booking moved by phone" : "Booking cancelled by phone";
  const sentence = moved
    ? `${input.contactName} moved their booking by phone.`
    : `${input.contactName} cancelled their booking by phone.`;
  const callerDisplay = input.callerNumber ?? "Number not shown";

  // Words, never an arrow between the two times: an arrow says nothing to a
  // screen reader or in the text part.
  const subject = moved
    ? `${heading}: ${stripSubjectControlChars(input.whenCompanyZone)} to `
      + `${stripSubjectControlChars(newWhen)} — ${stripSubjectControlChars(input.contactName)}`
    : `${heading}: ${stripSubjectControlChars(input.whenCompanyZone)}`
      + ` — ${stripSubjectControlChars(input.contactName)}`;

  const row = (label: string, value: string) => `<tr>
      <td style="${ROW_LABEL_STYLE}">${label}</td>
      <td style="${ROW_VALUE_STYLE}">${escapeHtml(value)}</td>
    </tr>`;
  const rows = [
    ...(moved
      ? [row("Was", input.whenCompanyZone), row("Now", newWhen)]
      : [row("When", input.whenCompanyZone)]),
    row("Who", input.contactName),
    row("Called from", callerDisplay),
  ].join("\n");

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${heading}</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(sentence)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>
    ${input.contactUrl ? button(input.brand, input.contactUrl, "Open this contact") : ""}
  `);

  // Composed, never derived by stripping tags.
  const text = [
    `${heading}.`,
    sentence,
    "",
    ...(moved
      ? [`Was: ${input.whenCompanyZone}`, `Now: ${newWhen}`]
      : [`When: ${input.whenCompanyZone}`]),
    `Who: ${input.contactName}`,
    `Called from: ${callerDisplay}`,
    ...(input.contactUrl ? ["", `Open this contact: ${input.contactUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}

/**
 * The customer's copy of a phone cancellation. Bilingual like the
 * confirmation, because the person who reads it is the same stranger.
 */
const CANCELLED_COPY = {
  en: {
    subject: "Your booking has been cancelled",
    title: "Your booking has been cancelled.",
    notYou: "If you didn't ask for this, please contact us right away.",
  },
  es: {
    subject: "Tu cita fue cancelada",
    title: "Tu cita fue cancelada.",
    notYou: "Si no pediste esta cancelación, comunícate con nosotros cuanto antes.",
  },
} as const;

export function bookingCancelledSubject(locale: PublicLocale = "en"): string {
  return CANCELLED_COPY[locale].subject;
}

export type BookingCancelledInput = {
  brand: EmailBrand;
  /** English when absent. `whenCompanyZone` is expected in the same language. */
  locale?: PublicLocale;
  /** The cancelled booking's time, pre-formatted in the company's zone. */
  whenCompanyZone: string;
};

/**
 * The email a customer gets after their booking is cancelled by phone.
 *
 * Same customer-facing restraint as `bookingConfirmationEmail`: brand header,
 * plain paragraphs, nothing to click. The last line is the point — a phone
 * cancellation is the one change a customer may hear about only from this
 * email, so it tells them what to do if it was not them.
 */
export function bookingCancelledEmail(input: BookingCancelledInput): { html: string; text: string } {
  const copy = CANCELLED_COPY[input.locale ?? "en"];

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(copy.title)}</p>
    <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenCompanyZone)}</p>
    <p style="margin:0;color:#71717a;">${escapeHtml(copy.notYou)}</p>
  `);

  const text = [copy.title, "", input.whenCompanyZone, "", copy.notYou].join("\n");

  return { html, text };
}
