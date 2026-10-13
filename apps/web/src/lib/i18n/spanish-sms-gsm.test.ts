import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";

/** S-09 PR 2, spec §13 and §15: every Spanish text default and lead is one GSM-7 alphabet. */
const SPANISH_SMS = [
  "automations.smsReminder.lead.es", "automations.smsReminder.leadNoName.es", "automations.smsReminder.defaultBody.es",
  "automations.appointmentConfirm.lead.es", "automations.appointmentConfirm.leadNoName.es",
  "automations.review.defaultBody.es", "automations.review.defaultBodyNoName.es",
  "automations.noShow.defaultBody.es", "automations.noShow.defaultBodyNoName.es",
  "automations.quoteFollowup.defaultBody.es", "automations.quoteFollowup.defaultBodyNoName.es",
  "automations.referral.defaultBody.es", "automations.referral.defaultBodyNoName.es",
] as const;

/** Customer-facing keys this PR sends in Spanish: a twin that merely repeats the English would pass the ratchet. */
const CUSTOMER = [
  ...SPANISH_SMS.map((k) => k.slice(0, -3)),
  "automations.referral.emailSubject", "automations.reactivation.defaultBody", "automations.reactivation.subject",
  "automations.reactivation.subjectNoName", "automations.reactivation.footerReason", "automations.quoteFollowup.emailSubject",
  "email.reminder.subject", "email.reminder.intro", "email.reminder.join", "email.reminder.cancel",
  "email.followup.defaultBody", "email.followup.subject", "email.review.subject", "email.review.button",
  "email.noShow.subject", "email.noShow.button",
] as const;

const cat = m as unknown as Record<string, string>;

describe("Spanish texts (spec §13)", () => {
  it.each(SPANISH_SMS)("%s is GSM-7, opt-out line included (mutation: write 'aquí' into it -> FAILS)", (key) => {
    const text = cat[key]!.replace("{name}", "Rio Roofing").replace("{when}", "sab, 17 de oct, 9:30 a.m. CDT");
    expect(segmentsFor(withOptOut(text, "es")).encoding).toBe("gsm7");
  });
});

describe("each customer key has a real Spanish twin (mutation: copy the English into the twin -> FAILS)", () => {
  it.each(CUSTOMER)("%s.es exists and differs from the English", (key) => {
    expect(cat[`${key}.es`], key).toBeTypeOf("string");
    expect(cat[`${key}.es`]).not.toBe(cat[key]);
  });
});
