import { m } from "@/lib/messages";

/**
 * What a past customer receives. Three things it deliberately is not: no
 * urgency, no discount, and no "we miss you". This message reaches someone
 * who has not thought about this business in nine months, and the only
 * version of it that is welcome is one that reads as a door left open.
 *
 * `brandName` is the customer-facing name; a blank one drops the clause.
 * Function replacement, not a plain string, for names containing `$&`.
 */
export function defaultReactivationBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.reactivation.defaultBodyNoName"];
  return m["automations.reactivation.defaultBody"].replace("{name}", () => brandName);
}

/** Plain, the brand name, and no exclamation mark — a subject line that
 *  looks like a newsletter gets treated as one. The blank-brand branch lives
 *  here rather than in the template for the same reason the referral ask's
 *  does: `brandDisplayName` returns `""` for an account that has never set a
 *  brand name, and a template interpolating it directly would send "A note
 *  from " with nothing after it. */
export function reactivationSubject(brandName: string): string {
  if (!brandName.trim()) return m["automations.reactivation.subjectNoName"];
  return m["automations.reactivation.subject"].replace("{name}", () => brandName);
}

/**
 * The footer's first line (decision A, 2026-09-22): why this person is
 * getting a check-in, and how to stop hearing from the business — by
 * REPLYING, because the email carries no link of any kind. The template
 * prints it above the postal address. Here rather than in the template for
 * the subject's reason: a blank brand would otherwise read "a customer of ."
 */
export function reactivationFooterReason(brandName: string): string {
  if (!brandName.trim()) return m["automations.reactivation.footerReasonNoName"];
  return m["automations.reactivation.footerReason"].replace("{name}", () => brandName);
}
