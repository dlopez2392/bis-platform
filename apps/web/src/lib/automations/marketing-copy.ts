import { m } from "@/lib/messages";

/**
 * The footer's first line in both MARKETING emails — the check-in
 * (`reactivation`, decision A, 2026-09-22) and the referral ask (B21,
 * 2026-09-23): why this person is getting it, and how to stop hearing from
 * the business — by REPLYING, because neither email carries a link of any
 * kind. `marketingFooter` prints it above the postal address.
 *
 * Renamed from `reactivationFooterReason` when the referral ask started
 * printing it, and moved here out of `reactivation-copy.ts`. ONE copy key
 * (`automations.reactivation.footerReason`, its no-name twin beside it): the
 * sentence names no recipe, so it reads true under either email.
 *
 * Here rather than in the template for the subject's reason: a blank brand
 * would otherwise read "a customer of ." Function replacement, not a plain
 * string, for names containing `$&`.
 */
export function marketingFooterReason(brandName: string): string {
  if (!brandName.trim()) return m["automations.reactivation.footerReasonNoName"];
  return m["automations.reactivation.footerReason"].replace("{name}", () => brandName);
}
