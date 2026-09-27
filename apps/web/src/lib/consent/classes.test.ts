import { describe, it, expect } from "vitest";
import { SMS_KINDS, isSmsKind } from "./classes";

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
};

describe("SMS_KINDS — the spec's table, row for row", () => {
  it("has exactly the spec's eleven PR-1 kinds, no more and no fewer — which also proves the consent.* kinds are NOT here yet (PR-2 is the first code to send them): a set equal to SPEC_TABLE's eleven names has no room for a twelfth (mutation: add or drop a kind → FAILS)", () => {
    expect(Object.keys(SMS_KINDS).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
    expect(Object.keys(SMS_KINDS)).toHaveLength(11);
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
