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
