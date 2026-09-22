import { m } from "@/lib/messages";

/**
 * What a customer receives when the operator has not written their own
 * referral ask. Three things this copy is NOT, each on purpose:
 *   - not a review request. It asks for a NAME, never a rating, and there is
 *     no link anywhere in it. `ReferralAskConfig` has no url field, so an
 *     operator cannot turn it into one by configuration either.
 *   - not urgent, and carries no offer. A referral bounty is a business
 *     decision nobody has taken.
 *   - not a form. "Reply with their name and number" uses the thread the
 *     customer is already in, which is the only channel that costs them
 *     nothing.
 *
 * `brandName` is the CUSTOMER-FACING name (the due-row carries only that).
 * Function replacement, not a plain string, for names containing `$&`.
 */
export function defaultReferralAskBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.referral.defaultBodyNoName"];
  return m["automations.referral.defaultBody"].replace("{name}", () => brandName);
}

/**
 * The email's subject line, here rather than in the template, for the same
 * reason the body's blank-brand branch is here: `brandDisplayName` returns
 * `""` for an account that has never set a brand name (`branding.ts:197-199`),
 * and a template that interpolates it directly sends "One favor, from "
 * with nothing after the comma. Task 8's `reactivationSubject` and Task 10's
 * `quoteFollowupSubject` are the same function for the same reason.
 */
export function referralAskSubject(brandName: string): string {
  if (!brandName.trim()) return m["automations.referral.emailSubjectNoName"];
  return m["automations.referral.emailSubject"].replace("{name}", () => brandName);
}
