import type { HoursRule } from "./hours";

/**
 * The message-class registry (consent chain spec §4.1 item 2). Every SMS the
 * platform sends has a stable KIND, and the kind — never the caller — decides
 * its class, its hours and its footer. The send gate (gate.ts) throws on a
 * kind that is not here, and source scan 2 (scans.test.ts) fails on any kind
 * literal passed to the gate that is not here.
 *
 * Classes: `customer_initiated` (a reply to what the customer just did),
 * `informational`, `marketing`, `staff_typed`, `operator`, `consent_reply`.
 * For SMS the class exempts NOTHING from a stop: after a stop the business
 * sends nothing but the one confirmation (decision 2), so the gate reads the
 * ledger for every kind here. The class decides the hours and, from PR-3 on,
 * which EMAIL kinds an unsubscribe does not stop (decision 7).
 *
 * The three `consent.*` kinds (the stop and start confirmations and the
 * help reply) are sent only by lib/consent/replies.ts (source scan), at any
 * hour (choice 18), with no footer: each line carries its own way out.
 *
 * Footer: `stop_line` is `withOptOut`'s disclosure, exactly as
 * sendAutomationSms and the text-back appended it before this registry
 * existed; `none` is what the composer, the alerts and the code sent.
 */
export type SmsClass =
  | "customer_initiated" | "informational" | "marketing" | "staff_typed" | "operator" | "consent_reply";

export type SmsKindSpec = { readonly class: SmsClass; readonly hours: HoursRule; readonly footer: "stop_line" | "none" };

export const SMS_KINDS = {
  "automation.instant_reply": { class: "customer_initiated", hours: "automated", footer: "stop_line" },
  "automation.appointment_confirm": { class: "informational", hours: "automated", footer: "stop_line" },
  "automation.sms_reminder": { class: "informational", hours: "automated", footer: "stop_line" },
  // Review requests, quote follow-ups and no-show nudges as MARKETING is the
  // spec's proposal (the stricter choice), for counsel with this table.
  "automation.no_show_nudge": { class: "marketing", hours: "marketing", footer: "stop_line" },
  "automation.referral_ask": { class: "marketing", hours: "marketing", footer: "stop_line" },
  "automation.review_request": { class: "marketing", hours: "marketing", footer: "stop_line" },
  "automation.quote_followup": { class: "marketing", hours: "marketing", footer: "stop_line" },
  "voice.textback": { class: "informational", hours: "automated", footer: "stop_line" },
  "staff.composer_sms": { class: "staff_typed", hours: "any", footer: "none" },
  // S-07 2b (plan deviation 11): a staff-chosen request, but its text is ours, so stops and quiet hours apply.
  "staff.document_request_sms": { class: "informational", hours: "automated", footer: "stop_line" },
  "operator.alert_sms": { class: "operator", hours: "any", footer: "none" },
  "operator.alert_phone_code": { class: "operator", hours: "any", footer: "none" },
  "consent.stop_confirmation": { class: "consent_reply", hours: "any", footer: "none" },
  "consent.start_confirmation": { class: "consent_reply", hours: "any", footer: "none" },
  "consent.help": { class: "consent_reply", hours: "any", footer: "none" },
} as const satisfies Record<string, SmsKindSpec>;

export type SmsKind = keyof typeof SMS_KINDS;

/** The kinds an automation pass sends through sendAutomationSms. */
export type AutomationSmsKind = Extract<SmsKind, `automation.${string}`>;

export function isSmsKind(kind: string): kind is SmsKind {
  return Object.prototype.hasOwnProperty.call(SMS_KINDS, kind);
}

/**
 * THE EMAIL KINDS (consent chain spec §4.3, corrected by the PR-3 plan's E1:
 * twenty-two send sites then; thirty-one kinds now, with the operational
 * floor's ops alert, F-048's cancel notice, the two emails of F-048's
 * customer move (the customer's and the business's), S-06's reply
 * forward, and F-046's staff confirmation and moved email, each named at
 * exactly one send site, which scans.test.ts pins).
 * The email gate (email-gate.ts) throws on a kind
 * that is not here, and scan 2 fails on any kind literal handed to it that
 * is not here.
 *
 * The CLASS decides what an unsubscribe stops (decision 7): `informational`
 * and `marketing` are automated mail, and the gate reads the ledger for them
 * alone; `customer_initiated` (a direct response to what the customer just
 * did, in the same request or live call, never a cron pass — scan 4 pins
 * where these kinds may be used), `staff_typed` (choice 22) and `operator`
 * (choice 23) are not subject to it. The HOURS: every automated kind keeps
 * the fixed automated window (choice 31). The FOOTER: every customer email
 * carries the unsubscribe link and the RFC 8058 headers, except staff-typed
 * email, a person's own reply (danlo's decision Q4, 2026-09-30; spec §4.3,
 * choice 22). Operator mail carries neither.
 *
 * `transactional` (item 8c, owner Q2, 2026-10-19) holds three kinds: the
 * customer's notice when staff undo one of Sofía's booking changes (item 8c),
 * and the confirmation and the moved email for a job staff put on the
 * calendar (F-046). Each is news about their own appointment, so an unsubscribe does not stop it
 * (decision 7 is unchanged: the gate still reads the ledger for the two
 * automated classes alone) and it may go at any hour; its words are ours, not
 * a person's, so it carries the unsubscribe footer. A hard bounce or a
 * complaint (D-016's suppression) blocks it as it blocks every customer class, and
 * a suppressed account sends nothing. It is not
 * `customer_initiated`: scan 4 keeps that class to where the customer acted.
 */
export type EmailClass = "customer_initiated" | "informational" | "marketing" | "staff_typed" | "operator" | "transactional";

export type EmailKindSpec = { readonly class: EmailClass; readonly hours: HoursRule; readonly footer: "unsubscribe" | "none" };

export const EMAIL_KINDS = {
  "booking.confirmation": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "forms.receipt": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.booked": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.moved": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.cancelled": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  // F-048: the customer moved their own booking from the link in their email;
  // this is the answer, in the same request, so an unsubscribe never stops it.
  "booking.moved": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "automation.reminder": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "automation.followup": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "automation.review_request": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.referral_ask": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.reactivation": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.quote_followup": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.no_show_nudge": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "staff.composer_email": { class: "staff_typed", hours: "any", footer: "none" },
  // F-048: the notice a person composes in the Calendar page's Cancel dialog
  // and sends by cancelling (after its Undo window). Staff-typed, as the
  // composer is: an unsubscribe does not stop a customer hearing that their
  // appointment is off, and it may go at any hour the owner cancels.
  "staff.booking_cancel_notice": { class: "staff_typed", hours: "any", footer: "none" },
  // S-07 2b (plan deviation 11): a staff-chosen request, but its text is ours, so stops and quiet hours apply.
  "staff.document_request_email": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "operator.booking_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.cancel_notice": { class: "operator", hours: "any", footer: "none" },
  "operator.move_notice": { class: "operator", hours: "any", footer: "none" },
  "operator.lead_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.call_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.phone_change_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.weekly_report": { class: "operator", hours: "any", footer: "none" },
  "operator.agency_report": { class: "operator", hours: "any", footer: "none" },
  "operator.billing_link": { class: "operator", hours: "any", footer: "none" },
  "operator.sender_check": { class: "operator", hours: "any", footer: "none" },
  "operator.ops_alert": { class: "operator", hours: "any", footer: "none" },
  // S-06 part 1: the owner's copy of a customer's reply; operator mail, as the lead alert is.
  "operator.reply_forward": { class: "operator", hours: "any", footer: "none" },
  // item 8c (owner Q2): staff undid one of Sofía's booking changes and chose to tell the customer.
  "booking.undo_notice": { class: "transactional", hours: "any", footer: "unsubscribe" },
  // F-046 part 1 (spec 6.6, owner decision 3): a person put a job on the calendar (or moved one) and chose
  // to tell the customer, sent once the Undo window has closed (CAL/job-hold.ts). News about their own
  // appointment in our words: an unsubscribe does not stop it, any hour, the unsubscribe footer.
  "staff.booking_confirmation": { class: "transactional", hours: "any", footer: "unsubscribe" },
  "staff.booking_moved": { class: "transactional", hours: "any", footer: "unsubscribe" },
} as const satisfies Record<string, EmailKindSpec>;

export type EmailKind = keyof typeof EMAIL_KINDS;
export type AutomationEmailKind = Extract<EmailKind, `automation.${string}`>;
export type OperatorEmailKind = Extract<EmailKind, `operator.${string}`>;
export type CustomerInitiatedEmailKind = {
  [K in EmailKind]: (typeof EMAIL_KINDS)[K]["class"] extends "customer_initiated" ? K : never;
}[EmailKind];

export function isEmailKind(kind: string): kind is EmailKind {
  return Object.prototype.hasOwnProperty.call(EMAIL_KINDS, kind);
}

/**
 * The non-payment pause (M7a PR-4, plan G7; owner answer Q1): every text to
 * the business's CUSTOMERS stops; the owner's own alerts (operator) and the
 * STOP/START/HELP answers (consent_reply) still go. Read only by the send
 * gate, after the switch.
 */
export function smsStopsWhilePaused(kind: SmsKind): boolean {
  const c = SMS_KINDS[kind].class;
  return c !== "operator" && c !== "consent_reply";
}

/** G8: only the automation kinds (which holdOrSend then HOLDS, G7a). Every
 *  other email keeps going (owner answer Q6), staff.document_request_email
 *  included: it is an email to the customer; its SMS twin stops above. */
export function emailStopsWhilePaused(kind: EmailKind): boolean {
  return kind.startsWith("automation.");
}

/** Decision 7: an unsubscribe stops the automated classes, and only those. */
export function emailReadsLedger(kind: EmailKind): boolean {
  const cls = EMAIL_KINDS[kind].class;
  return cls === "informational" || cls === "marketing";
}

/**
 * Decision P1 (danlo, 2026-09-30; spec §4.3, §10): the three marketing kinds
 * whose templates print no postal address. The email gate adds the account's
 * `mailing_address` to their footer WHENEVER it is set, and a blank one never
 * blocks them — they follow up the customer's own request or appointment
 * (relationship mail; counsel reviews that reading at go-live). The check-in
 * and the referral ask are not here: their templates print the address
 * themselves (marketing-footer.ts) and their passes skip an account with none.
 */
export const FOOTER_ADDRESS_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>([
  "automation.review_request", "automation.quote_followup", "automation.no_show_nudge",
]);
