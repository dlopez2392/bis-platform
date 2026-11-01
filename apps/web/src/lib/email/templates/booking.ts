import { shell, button, escapeHtml, type EmailBrand } from "./shell";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The confirmation, the reschedule and the cancellation a phone call sends
 * follow the language of the moment (the page, the call). The reminder
 * follows the customer's own language (S-09 PR 2: the contact's, else the
 * account's, else English), resolved by the due-list. The owner's alerts
 * follow the ACCOUNT's language (S-10; see `bookingAlertEmail` below).
 */
const CONFIRMATION_COPY = {
  en: {
    subject: "You're booked in",
    title: "You're booked in.",
    forUs: (when: string) => `${when} for us`,
    join: "Join your video meeting",
    cancel: "Cancel this booking",
    // F-048: the add-to-calendar file (`app/b/[publicId]/ics/[token]`).
    addToCalendar: "Add to your calendar",
    // F-048: the customer's own move (`app/b/[publicId]/move/[token]`).
    move: "Change the time",
    // F-046: where a job staff put on the calendar happens (the place's label and address).
    where: "Where",
  },
  es: {
    subject: "Tu cita quedó agendada",
    title: "Tu cita quedó agendada.",
    forUs: (when: string) => `${when} para nosotros`,
    join: "Unirse a la videollamada",
    cancel: "Cancelar esta cita",
    addToCalendar: "Agregar a tu calendario",
    move: "Cambiar el horario",
    where: "Dónde",
  },
} as const;

export function bookingConfirmationSubject(locale: PublicLocale = "en"): string {
  return CONFIRMATION_COPY[locale].subject;
}

const ROW_LABEL_STYLE =
  "padding:4px 12px 4px 0;color:#71717a;white-space:nowrap;vertical-align:top;";
const ROW_VALUE_STYLE = "padding:4px 0;vertical-align:top;";

/** F-046: the one "Where" row under the time, the place's label and address on
 *  one line. Nothing at all without one: never an empty label. */
function whereRow(where: string | undefined, label: string): string {
  return where
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
        <td style="${ROW_LABEL_STYLE}">${escapeHtml(label)}</td>
        <td style="${ROW_VALUE_STYLE}">${escapeHtml(where)}</td>
      </tr></table>`
    : "";
}

/** F-048: a secondary customer link (the calendar file, a change of time):
 *  plain, like the cancel link, and nothing at all without a url. */
function plainLink(url: string | undefined, label: string): string {
  return url
    ? `<p style="margin:0 0 8px;"><a href="${escapeHtml(url)}" style="color:#71717a;">${escapeHtml(label)}</a></p>`
    : "";
}

/**
 * S-10 (booking alerts): the OWNER's booking mail — the new-booking alert,
 * the cancel notice, the moved alert and the phone-change alert — follows
 * `accounts.language ?? "en"` (spec 2026-10-31 §3.3), the lead and call
 * alerts' rule. One message, one language, end to end: every caller formats
 * its when-strings with `formatWhen(instant, accountZone, locale)` in the
 * SAME locale it passes here. English when absent, byte-identical to before.
 */
const label = (key: "when" | "who" | "note" | "was" | "now" | "calledFrom", locale: Locale) =>
  t(m, `email.bookingAlert.label.${key}`, locale);

/** The name an owner alert shows for a contact with none on file. */
export function ownerAlertFallbackName(locale: Locale = "en"): string {
  return t(m, "email.bookingAlert.someone", locale);
}

/** Time first (spec §6): the owner triages a list of these, and the time is
 *  what they scan for, not the name. `when` is server-computed from a real
 *  timestamp (never attacker input), so only the name is made header-safe. */
export function bookingAlertSubject(when: string, contactName: string, locale: Locale = "en"): string {
  return t(m, "email.bookingAlert.subject", locale, { when, name: stripSubjectControlChars(contactName) });
}

export type BookingAlertInput = {
  brand: EmailBrand;
  /** Pre-formatted by the caller in the company's own zone, IN `locale`.
   *  Templates format nothing — that discipline stays at the call site. */
  whenCompanyZone: string;
  /** Attacker-supplied: typed into a public booking page. */
  contactName: string;
  /** Attacker-supplied, same as `contactName`. */
  note: string | null;
  /** Absolute, or null when the request carried no host. NEVER relative. */
  contactUrl: string | null;
  /** S-10: the account's language. English when absent. */
  locale?: Locale;
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
  const locale = input.locale ?? "en";
  const openContact = t(m, "email.alert.openContact", locale);
  const noteRow = input.note
    ? `<tr>
        <td style="${ROW_LABEL_STYLE}">${escapeHtml(label("note", locale))}</td>
        <td style="${ROW_VALUE_STYLE}">${escapeHtml(input.note)}</td>
      </tr>`
    : "";

  const rows = `<tr>
      <td style="${ROW_LABEL_STYLE}">${escapeHtml(label("when", locale))}</td>
      <td style="${ROW_VALUE_STYLE}">${escapeHtml(input.whenCompanyZone)}</td>
    </tr>
    <tr>
      <td style="${ROW_LABEL_STYLE}">${escapeHtml(label("who", locale))}</td>
      <td style="${ROW_VALUE_STYLE}">${escapeHtml(input.contactName)}</td>
    </tr>
    ${noteRow}`;

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(t(m, "email.bookingAlert.heading", locale))}</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(t(m, "email.bookingAlert.sentence", locale, { name: input.contactName }))}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>
    ${input.contactUrl ? button(input.brand, input.contactUrl, openContact) : ""}
  `);

  // Composed, never derived by stripping tags — the version a human would
  // have written, and what a text-only client shows.
  const text = [
    t(m, "email.bookingAlert.text", locale, { name: input.contactName }),
    "",
    `${label("when", locale)}: ${input.whenCompanyZone}`,
    `${label("who", locale)}: ${input.contactName}`,
    ...(input.note ? [`${label("note", locale)}: ${input.note}`] : []),
    ...(input.contactUrl ? ["", `${openContact}: ${input.contactUrl}`] : []),
  ].join("\n");

  return { html, text };
}

export type BookingCancelNoticeInput = {
  /** The cancelled booking's time, pre-formatted in the company zone, IN `locale`. */
  whenCompanyZone: string;
  /** From the contact row — customer-supplied. */
  contactName: string;
  /** The booking's own note, as the customer typed it. */
  note: string | null;
  /** S-10: the account's language. English when absent. */
  locale?: Locale;
};

/**
 * The email a client gets when their CUSTOMER cancels from the link in their
 * own email (`b/[publicId]/cancel/[token]`). Text-only, as it always was: it
 * has no html part, and adding one would change what an English owner gets.
 * It returns its own subject because the subject carries the customer's name.
 */
export function bookingCancelNoticeEmail(input: BookingCancelNoticeInput): { subject: string; text: string } {
  const locale = input.locale ?? "en";
  const subject = t(m, "email.cancelNotice.subject", locale, {
    when: stripSubjectControlChars(input.whenCompanyZone), name: stripSubjectControlChars(input.contactName),
  });
  const text = [
    t(m, "email.cancelNotice.sentence", locale, { name: input.contactName }), "",
    `${label("when", locale)}: ${input.whenCompanyZone}`,
    ...(input.note ? [`${label("note", locale)}: ${input.note}`] : []),
  ].join("\n");
  return { subject, text };
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
  /** F-048: the booking's add-to-calendar file (`calendarFileUrl`). Same
   *  empty-vs-absent discipline as `cancelUrl`: "" or absent, no line. */
  calendarUrl?: string;
  /** F-048: where the customer moves this booking themselves (`bookingMoveUrl` in
   *  lib/booking/links.ts). "" or absent, no line. */
  moveUrl?: string;
  /** F-046: where the job happens, one line ("label · address"). The job's own
   *  "what" line is never passed here (owner decision 4). "" or absent, no row. */
  where?: string;
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

  // F-048: a plain link, like the cancel link — the file is a convenience,
  // not the call to action the video room is.
  const calendarHtml = input.calendarUrl
    ? `<p style="margin:0 0 8px;"><a href="${escapeHtml(input.calendarUrl)}" style="color:#71717a;">${escapeHtml(copy.addToCalendar)}</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(copy.title)}</p>
    ${whenHtml}${whereRow(input.where, copy.where)}
    ${meetingHtml}
    ${calendarHtml}
    ${plainLink(input.moveUrl, copy.move)}
    ${cancelHtml}
  `);

  const text = [
    copy.title,
    "",
    input.whenBookerZone,
    ...(sameZone ? [] : [copy.forUs(input.whenCompanyZone)]),
    ...(input.where ? [`${copy.where}: ${input.where}`] : []),
    ...(input.meetingUrl ? ["", `${copy.join}: ${input.meetingUrl}`] : []),
    ...(input.calendarUrl ? ["", `${copy.addToCalendar}: ${input.calendarUrl}`] : []),
    ...(input.moveUrl ? ["", `${copy.move}: ${input.moveUrl}`] : []),
    ...(input.cancelUrl ? ["", `${copy.cancel}: ${input.cancelUrl}`] : []),
  ].join("\n");

  return { html, text };
}

/**
 * The reschedule email's copy, per language (D-038: it had no Spanish
 * version, so a caller who moved their appointment in Spanish got English).
 * Same tú register as `CONFIRMATION_COPY` and `CANCELLED_COPY`.
 */
const RESCHEDULED_COPY = {
  en: {
    subject: "Your booking has been moved",
    title: "Your booking has been moved.",
    forUs: (when: string) => `${when} for us`,
    join: "Join your video meeting",
    replaces: "This link replaces the one from your earlier confirmation.",
    cancel: "Cancel this booking",
    addToCalendar: CONFIRMATION_COPY.en.addToCalendar,
    move: CONFIRMATION_COPY.en.move,
    where: CONFIRMATION_COPY.en.where,
  },
  es: {
    subject: "Tu cita fue reprogramada",
    title: "Tu cita fue reprogramada.",
    forUs: (when: string) => `${when} para nosotros`,
    join: "Unirse a la videollamada",
    replaces: "Este enlace reemplaza al de tu confirmación anterior.",
    cancel: "Cancelar esta cita",
    addToCalendar: CONFIRMATION_COPY.es.addToCalendar,
    move: CONFIRMATION_COPY.es.move,
    where: CONFIRMATION_COPY.es.where,
  },
} as const;

export function bookingRescheduledSubject(locale: PublicLocale = "en"): string {
  return RESCHEDULED_COPY[locale].subject;
}

export type BookingRescheduledInput = {
  brand: EmailBrand;
  /** The caller's language; English when absent. Both when-strings are
   *  expected to have been formatted in the same language by the caller. */
  locale?: PublicLocale;
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
  /** F-048: the NEW booking's add-to-calendar file. Its UID is the first
   *  booking's and its SEQUENCE the number of moves (`rescheduleChain`), so
   *  opening it updates the event the customer already saved. "" or absent,
   *  no line. */
  calendarUrl?: string;
  /** F-048: the NEW booking's change-of-time link. "" or absent, no line. */
  moveUrl?: string;
  /** F-046: where the job happens, one line; same discipline as
   *  `BookingConfirmationInput.where`. */
  where?: string;
};

/**
 * The email a booker gets after their booking is MOVED: by phone, through
 * the voice assistant's reschedule tool, or by the customer themselves from
 * the link in their email (F-048, kind `booking.moved`).
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
  const copy = RESCHEDULED_COPY[input.locale ?? "en"];
  const sameZone = input.whenBookerZone === input.whenCompanyZone;

  const whenHtml = sameZone
    ? `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>`
    : `<p style="margin:0 0 4px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
       <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(copy.forUs(input.whenCompanyZone))}</p>`;

  const meetingHtml = input.meetingUrl
    ? `<p style="margin:0 0 4px;">${button(input.brand, input.meetingUrl, copy.join)}</p>
       <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(copy.replaces)}</p>`
    : "";

  // Same reasoning as `bookingConfirmationEmail`'s `cancelHtml`: an empty
  // `cancelUrl` gets no anchor at all, never one pointing nowhere.
  const cancelHtml = input.cancelUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">${escapeHtml(copy.cancel)}</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(copy.title)}</p>
    ${whenHtml}${whereRow(input.where, copy.where)}
    ${meetingHtml}
    ${plainLink(input.calendarUrl, copy.addToCalendar)}
    ${plainLink(input.moveUrl, copy.move)}
    ${cancelHtml}
  `);

  const text = [
    copy.title,
    "",
    input.whenBookerZone,
    ...(sameZone ? [] : [copy.forUs(input.whenCompanyZone)]),
    ...(input.where ? [`${copy.where}: ${input.where}`] : []),
    ...(input.meetingUrl
      ? ["", `${copy.join}: ${input.meetingUrl}`, copy.replaces]
      : []),
    ...(input.calendarUrl ? ["", `${copy.addToCalendar}: ${input.calendarUrl}`] : []),
    ...(input.moveUrl ? ["", `${copy.move}: ${input.moveUrl}`] : []),
    ...(input.cancelUrl ? ["", `${copy.cancel}: ${input.cancelUrl}`] : []),
  ].join("\n");

  return { html, text };
}

export function bookingReminderSubject(locale: PublicLocale = "en"): string {
  return t(m, "email.reminder.subject", locale);
}

export type BookingReminderInput = {
  brand: EmailBrand;
  /** Pre-formatted in the booker's own zone, IN `locale` (formatWhen's third argument). */
  whenBookerZone: string;
  cancelUrl: string;
  /** Same discipline as `BookingConfirmationInput.meetingUrl`: present only
   *  when the calendar is `"video"` AND the room still exists at reminder
   *  time — omitted entirely, never a link to nowhere. */
  meetingUrl?: string;
  /** S-09 PR 2: the customer's language. One message, one language (C11). English by default. */
  locale?: PublicLocale;
};

/**
 * The reminder a booker gets ~24h before their booking — or, for a booking
 * made less than a day ahead, ~3-4h before it (D-029, `LATE_REMINDER_*` in
 * packages/db/src/booking.ts). The copy therefore never says "tomorrow": it
 * names the time and nothing relative.
 *
 * The confirmation minus the company-zone line and minus the "you're booked"
 * novelty: the booker already knows they're booked, so the subject here is
 * "this is coming up", not a repeat of the original news. The video link, when
 * present, gets the same `button()` treatment as the confirmation's — it IS
 * the meeting, so it outweighs the plain cancel link here too.
 */
export function bookingReminderEmail(input: BookingReminderInput):
  { html: string; text: string } {
  const locale = input.locale ?? "en";
  const join = t(m, "email.reminder.join", locale);
  const cancel = t(m, "email.reminder.cancel", locale);
  const intro = t(m, "email.reminder.intro", locale);
  const meetingHtml = input.meetingUrl
    ? `<p style="margin:0 0 16px;">${button(input.brand, input.meetingUrl, join)}</p>`
    : "";

  // Same reasoning as `bookingConfirmationEmail`'s `cancelHtml`: an empty
  // `cancelUrl` gets no anchor at all, never one pointing nowhere.
  const cancelHtml = input.cancelUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">${escapeHtml(cancel)}</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
    <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
    ${meetingHtml}
    ${cancelHtml}
  `);

  const text = [
    intro, "", input.whenBookerZone,
    ...(input.meetingUrl ? ["", `${join}: ${input.meetingUrl}`] : []),
    ...(input.cancelUrl ? ["", `${cancel}: ${input.cancelUrl}`] : []),
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
  /** S-10: the account's language — never the caller's, which the customer's
   *  own email follows. Both when-strings are expected in this language too.
   *  English when absent. */
  locale?: Locale;
};

/** One label/value row of an owner alert's table. The label is catalogue
 *  copy (escaped all the same); the value is escaped because it can be the
 *  customer's own words. */
function alertRow(rowLabel: string, value: string): string {
  return `<tr>
      <td style="${ROW_LABEL_STYLE}">${escapeHtml(rowLabel)}</td>
      <td style="${ROW_VALUE_STYLE}">${escapeHtml(value)}</td>
    </tr>`;
}

/**
 * The email a client gets when the phone receptionist cancels or moves one of
 * their bookings on a call.
 *
 * Operator-facing, like `bookingAlertEmail`, in the account's language (S-10).
 * It returns its own subject because the subject carries the
 * customer-supplied name and has to be made header-safe in one place.
 */
export function bookingPhoneChangeAlertEmail(input: BookingPhoneChangeAlertInput):
  { subject: string; html: string; text: string } {
  const locale = input.locale ?? "en";
  const moved = input.kind === "moved";
  const newWhen = input.newWhenCompanyZone ?? "";
  const heading = t(m, moved ? "email.phoneChangeAlert.heading.moved" : "email.phoneChangeAlert.heading.cancelled", locale);
  const sentence = t(m, moved ? "email.phoneChangeAlert.sentence.moved" : "email.phoneChangeAlert.sentence.cancelled",
    locale, { name: input.contactName });
  const callerDisplay = input.callerNumber ?? t(m, "email.phoneChangeAlert.numberHidden", locale);
  const openContact = t(m, "email.alert.openContact", locale);

  // Words, never an arrow between the two times: an arrow says nothing to a
  // screen reader or in the text part.
  const name = stripSubjectControlChars(input.contactName);
  const subject = moved
    ? t(m, "email.phoneChangeAlert.subject.moved", locale, {
      was: stripSubjectControlChars(input.whenCompanyZone), now: stripSubjectControlChars(newWhen), name,
    })
    : t(m, "email.phoneChangeAlert.subject.cancelled", locale, { when: stripSubjectControlChars(input.whenCompanyZone), name });

  const rows = [
    ...(moved
      ? [alertRow(label("was", locale), input.whenCompanyZone), alertRow(label("now", locale), newWhen)]
      : [alertRow(label("when", locale), input.whenCompanyZone)]),
    alertRow(label("who", locale), input.contactName),
    alertRow(label("calledFrom", locale), callerDisplay),
  ].join("\n");

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(heading)}</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(sentence)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>
    ${input.contactUrl ? button(input.brand, input.contactUrl, openContact) : ""}
  `);

  // Composed, never derived by stripping tags.
  const text = [
    `${heading}.`,
    sentence,
    "",
    ...(moved
      ? [`${label("was", locale)}: ${input.whenCompanyZone}`, `${label("now", locale)}: ${newWhen}`]
      : [`${label("when", locale)}: ${input.whenCompanyZone}`]),
    `${label("who", locale)}: ${input.contactName}`,
    `${label("calledFrom", locale)}: ${callerDisplay}`,
    ...(input.contactUrl ? ["", `${openContact}: ${input.contactUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}

export type BookingMovedAlertInput = {
  brand: EmailBrand;
  /** The time BEFORE the move, pre-formatted in the company zone, IN `locale`. */
  whenCompanyZone: string;
  /** The new time, pre-formatted in the company zone, IN `locale`. */
  newWhenCompanyZone: string;
  /** From the contact row — customer-supplied (typed on a booking page). */
  contactName: string;
  /** Absolute, or null. NEVER relative. */
  contactUrl: string | null;
  /** S-10: the OWNER's language, `accounts.language ?? "en"` — never the
   *  customer's page language, which their own "moved" email follows.
   *  English when absent. */
  locale?: Locale;
};

/**
 * F-048: the email a client gets when their CUSTOMER moves a booking from
 * the link in their own email. The phone alert's shape without the call:
 * both times in words (never an arrow), who, and the contact. Operator-facing;
 * it returns its own subject because the subject carries the
 * customer-supplied name.
 */
export function bookingMovedAlertEmail(input: BookingMovedAlertInput):
  { subject: string; html: string; text: string } {
  const locale = input.locale ?? "en";
  const heading = t(m, "email.movedAlert.heading", locale);
  const sentence = t(m, "email.movedAlert.sentence", locale, { name: input.contactName });
  const openContact = t(m, "email.alert.openContact", locale);
  const subject = t(m, "email.movedAlert.subject", locale, {
    was: stripSubjectControlChars(input.whenCompanyZone), now: stripSubjectControlChars(input.newWhenCompanyZone),
    name: stripSubjectControlChars(input.contactName),
  });

  const rows = [
    alertRow(label("was", locale), input.whenCompanyZone), alertRow(label("now", locale), input.newWhenCompanyZone),
    alertRow(label("who", locale), input.contactName),
  ].join("\n");

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${escapeHtml(heading)}</p>
    <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(sentence)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${rows}</table>
    ${input.contactUrl ? button(input.brand, input.contactUrl, openContact) : ""}
  `);

  const text = [
    `${heading}.`,
    sentence,
    "",
    `${label("was", locale)}: ${input.whenCompanyZone}`,
    `${label("now", locale)}: ${input.newWhenCompanyZone}`,
    `${label("who", locale)}: ${input.contactName}`,
    ...(input.contactUrl ? ["", `${openContact}: ${input.contactUrl}`] : []),
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

/**
 * F-048: the customer's copy of a cancel the BUSINESS made, from the Calendar
 * page. Same tú register as `CONFIRMATION_COPY`; the subject and title are
 * `CANCELLED_COPY`'s own words, so a customer reads the same sentence
 * whoever cancelled. The owner's own message (shown, and editable, in the
 * Cancel dialog) sits between the time and the way to book again.
 */
const BUSINESS_CANCELLED_COPY = {
  en: {
    subject: CANCELLED_COPY.en.subject,
    title: CANCELLED_COPY.en.title,
    forUs: (when: string) => `${when} for us`,
    rebook: "Book a new time",
  },
  es: {
    subject: CANCELLED_COPY.es.subject,
    title: CANCELLED_COPY.es.title,
    forUs: (when: string) => `${when} para nosotros`,
    rebook: "Agendar otro horario",
  },
} as const;

export function bookingCancelledByBusinessSubject(locale: PublicLocale = "en"): string {
  return BUSINESS_CANCELLED_COPY[locale].subject;
}

export type BookingCancelledByBusinessInput = {
  brand: EmailBrand;
  /** The language the owner chose for this notice. English when absent. */
  locale?: PublicLocale;
  /** The cancelled time in the booker's own zone, in `locale`. */
  whenBookerZone: string;
  /** The same time in the business's zone; shown only when it reads
   *  differently, the confirmation's rule. */
  whenCompanyZone: string;
  /** Typed (or left as the default) by the owner. Plain text: escaped, and
   *  its line breaks kept. Blank leaves the paragraph out. */
  message: string;
  /** The booking page, to choose a new time. "" when the calendar is off or
   *  there is no origin: no line at all, never a link to nowhere. */
  rebookUrl: string;
};

export function bookingCancelledByBusinessEmail(input: BookingCancelledByBusinessInput):
  { html: string; text: string } {
  const copy = BUSINESS_CANCELLED_COPY[input.locale ?? "en"];
  const sameZone = input.whenBookerZone === input.whenCompanyZone;
  const message = input.message.trim();

  const whenHtml = sameZone
    ? `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>`
    : `<p style="margin:0 0 4px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
       <p style="margin:0 0 16px;color:#71717a;">${escapeHtml(copy.forUs(input.whenCompanyZone))}</p>`;
  const messageHtml = message
    ? `<p style="margin:0 0 16px;">${escapeHtml(message).replace(/\n/g, "<br />")}</p>`
    : "";
  const rebookHtml = input.rebookUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.rebookUrl)}" style="color:#71717a;">${escapeHtml(copy.rebook)}</a></p>`
    : "";

  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(copy.title)}</p>
    ${whenHtml}
    ${messageHtml}
    ${rebookHtml}
  `);

  const text = [
    copy.title,
    "",
    input.whenBookerZone,
    ...(sameZone ? [] : [copy.forUs(input.whenCompanyZone)]),
    ...(message ? ["", message] : []),
    ...(input.rebookUrl ? ["", `${copy.rebook}: ${input.rebookUrl}`] : []),
  ].join("\n");

  return { html, text };
}
