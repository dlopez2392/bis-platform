import { describe, it, expect } from "vitest";
import { SMS_KINDS, isSmsKind, EMAIL_KINDS, isEmailKind, emailReadsLedger, FOOTER_ADDRESS_KINDS, type EmailKind } from "./classes";

/**
 * The registry IS the spec's §4.1 item 2 table, row for row: a kind moved to
 * a looser class or hours rule is a legal change, not a refactor, so it must
 * fail here and be argued in review. The footer column is this plan's (the
 * spec's table has none): `stop_line` for exactly the kinds that carried
 * `withOptOut` before the registry existed.
 */
const SPEC_TABLE: Record<string, [string, string, string]> = {
  "automation.instant_reply": ["customer_initiated", "automated", "stop_line"],
  "automation.appointment_confirm": ["informational", "automated", "stop_line"],
  "automation.sms_reminder": ["informational", "automated", "stop_line"],
  "automation.no_show_nudge": ["marketing", "marketing", "stop_line"],
  "automation.referral_ask": ["marketing", "marketing", "stop_line"],
  "automation.review_request": ["marketing", "marketing", "stop_line"],
  "automation.quote_followup": ["marketing", "marketing", "stop_line"],
  "voice.textback": ["informational", "automated", "stop_line"],
  "staff.composer_sms": ["staff_typed", "any", "none"],
  "operator.alert_sms": ["operator", "any", "none"],
  "operator.alert_phone_code": ["operator", "any", "none"],
  // PR-2 (spec §4.1 item 2's last row; choice 18: any hour). No footer: each
  // line carries its own way out (spec §4.2's table).
  "consent.stop_confirmation": ["consent_reply", "any", "none"],
  "consent.start_confirmation": ["consent_reply", "any", "none"],
  "consent.help": ["consent_reply", "any", "none"],
};

describe("SMS_KINDS — the spec's table, row for row", () => {
  it("has exactly the spec's fourteen kinds — PR-1's eleven and PR-2's three consent replies — no more and no fewer (mutation: add or drop a kind → FAILS)", () => {
    expect(Object.keys(SMS_KINDS).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
    expect(Object.keys(SMS_KINDS)).toHaveLength(14);
  });

  it.each(Object.entries(SPEC_TABLE))("%s is %j — its own class, hours and footer, none borrowed from another row (mutation: change any one of this row's three fields → FAILS)", (kind, [cls, hours, footer]) => {
    const spec = SMS_KINDS[kind as keyof typeof SMS_KINDS];
    expect([spec.class, spec.hours, spec.footer]).toEqual([cls, hours, footer]);
  });
});

describe("isSmsKind", () => {
  it("knows the registry's kinds and nothing inherited from Object (mutation: `in` → 'toString' passes, FAILS)", () => {
    expect(isSmsKind("voice.textback")).toBe(true);
    expect(isSmsKind("toString")).toBe(false);
    expect(isSmsKind("constructor")).toBe(false);
    expect(isSmsKind("automation.reactivation")).toBe(false);
  });
});

/**
 * The email half (spec §4.3's table, corrected 2026-09-30 by E1: twenty-two
 * sites). A kind moved to a looser class is a legal change (decision 7 decides
 * what an unsubscribe stops by class), so it must fail here and be argued.
 * Hours: choice 31 (automated email keeps the fixed automated window).
 * Footer: every customer email carries the unsubscribe link and headers,
 * except staff-typed email (decision Q4).
 */
const EMAIL_TABLE: Record<string, [string, string, string]> = {
  "booking.confirmation": ["customer_initiated", "any", "unsubscribe"],
  "forms.receipt": ["customer_initiated", "any", "unsubscribe"],
  "voice.booked": ["customer_initiated", "any", "unsubscribe"],
  "voice.moved": ["customer_initiated", "any", "unsubscribe"],
  "voice.cancelled": ["customer_initiated", "any", "unsubscribe"],
  "automation.reminder": ["informational", "automated", "unsubscribe"],
  "automation.followup": ["informational", "automated", "unsubscribe"],
  "automation.review_request": ["marketing", "automated", "unsubscribe"],
  "automation.referral_ask": ["marketing", "automated", "unsubscribe"],
  "automation.reactivation": ["marketing", "automated", "unsubscribe"],
  "automation.quote_followup": ["marketing", "automated", "unsubscribe"],
  "automation.no_show_nudge": ["marketing", "automated", "unsubscribe"],
  "staff.composer_email": ["staff_typed", "any", "none"],
  "operator.booking_alert": ["operator", "any", "none"],
  "operator.cancel_notice": ["operator", "any", "none"],
  "operator.lead_alert": ["operator", "any", "none"],
  "operator.call_alert": ["operator", "any", "none"],
  "operator.phone_change_alert": ["operator", "any", "none"],
  "operator.weekly_report": ["operator", "any", "none"],
  "operator.agency_report": ["operator", "any", "none"],
  "operator.billing_link": ["operator", "any", "none"],
  "operator.sender_check": ["operator", "any", "none"],
};

describe("EMAIL_KINDS — spec §4.3's table, row for row", () => {
  it("has exactly the twenty-two send sites (E1) — no more and no fewer (mutation: add or drop a kind → FAILS)", () => {
    expect(Object.keys(EMAIL_KINDS).sort()).toEqual(Object.keys(EMAIL_TABLE).sort());
    expect(Object.keys(EMAIL_KINDS)).toHaveLength(22);
  });

  it.each(Object.entries(EMAIL_TABLE))("%s is %j (mutation: change any one of this row's three fields → FAILS)", (kind, [cls, hours, footer]) => {
    const spec = EMAIL_KINDS[kind as EmailKind];
    expect([spec.class, spec.hours, spec.footer]).toEqual([cls, hours, footer]);
  });

  it("every operator kind is named operator.* and carries no footer; every customer kind but the staff-typed one carries it (choice 23; mutation: give an operator kind the footer → FAILS)", () => {
    for (const [kind, spec] of Object.entries(EMAIL_KINDS)) {
      expect(spec.class === "operator", kind).toBe(kind.startsWith("operator."));
      expect(spec.footer === "unsubscribe", kind).toBe(spec.class !== "operator" && spec.class !== "staff_typed");
    }
  });
});

describe("emailReadsLedger — what an unsubscribe stops (decision 7)", () => {
  it("reads the ledger for the automated classes alone: informational and marketing (mutation: include customer_initiated → a booking confirmation after an unsubscribe is refused, FAILS)", () => {
    const reads = Object.keys(EMAIL_KINDS).filter((k) => emailReadsLedger(k as EmailKind)).sort();
    expect(reads).toEqual([
      "automation.followup", "automation.no_show_nudge", "automation.quote_followup", "automation.reactivation",
      "automation.referral_ask", "automation.reminder", "automation.review_request",
    ]);
  });
});

describe("isEmailKind", () => {
  it("knows the registry's kinds and nothing inherited from Object; an SMS-only kind is not an email kind (mutation: `in` → 'toString' passes, FAILS)", () => {
    expect(isEmailKind("automation.reminder")).toBe(true);
    expect(isEmailKind("toString")).toBe(false);
    expect(isEmailKind("voice.textback")).toBe(false);
    expect(isEmailKind("automation.sms_reminder")).toBe(false);
  });
});

describe("FOOTER_ADDRESS_KINDS — decision P1 (spec §4.3, §10)", () => {
  it("is exactly the three marketing kinds whose templates print no postal address; the check-in and the referral ask print their own (mutation: add automation.reactivation → its address prints twice, FAILS; drop no_show_nudge → FAILS)", () => {
    expect([...FOOTER_ADDRESS_KINDS].sort()).toEqual(["automation.no_show_nudge", "automation.quote_followup", "automation.review_request"]);
    for (const kind of FOOTER_ADDRESS_KINDS) {
      expect(EMAIL_KINDS[kind].class, kind).toBe("marketing");
      expect(EMAIL_KINDS[kind].footer, kind).toBe("unsubscribe");
    }
  });
});
