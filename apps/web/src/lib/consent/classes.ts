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
 * twenty-two send sites). The email gate (email-gate.ts) throws on a kind
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
 */
export type EmailClass = "customer_initiated" | "informational" | "marketing" | "staff_typed" | "operator";

export type EmailKindSpec = { readonly class: EmailClass; readonly hours: HoursRule; readonly footer: "unsubscribe" | "none" };

export const EMAIL_KINDS = {
  "booking.confirmation": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "forms.receipt": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.booked": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.moved": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.cancelled": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "automation.reminder": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "automation.followup": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "automation.review_request": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.referral_ask": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.reactivation": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.quote_followup": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.no_show_nudge": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "staff.composer_email": { class: "staff_typed", hours: "any", footer: "none" },
  "operator.booking_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.cancel_notice": { class: "operator", hours: "any", footer: "none" },
  "operator.lead_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.call_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.phone_change_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.weekly_report": { class: "operator", hours: "any", footer: "none" },
  "operator.agency_report": { class: "operator", hours: "any", footer: "none" },
  "operator.billing_link": { class: "operator", hours: "any", footer: "none" },
  "operator.sender_check": { class: "operator", hours: "any", footer: "none" },
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
