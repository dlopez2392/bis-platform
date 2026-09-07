import { m } from "@/lib/messages";
import { withTrailingLink } from "./sms-link";

/**
 * What a customer receives when the operator has not written their own
 * review request. `brandName` is the CUSTOMER-FACING name (brandDisplayName
 * in @bis/db) — the due-row carries only that, so this function cannot be
 * handed the agency's internal label. Blank name: the identifying clause is
 * dropped, never replaced with an invented noun (the text-back precedent).
 *
 * Function replacement, not a plain string: a company name containing `$&`
 * or `$'` would otherwise be re-interpreted by String.replace.
 */
export function defaultReviewRequestBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.review.defaultBodyNoName"];
  return m["automations.review.defaultBody"].replace("{name}", () => brandName);
}

/**
 * The review request's name for withTrailingLink (sms-link.ts). The settings
 * page's segment counter and the review-request pass both call this with the
 * same inputs, so the count the operator approves is the count that sends —
 * the preview-vs-send drift fixed twice on 2026-09-06 cannot recur by
 * construction. No template tokens: the operator writes prose, the link goes
 * on the end, always.
 *
 * An empty url yields the body alone — what the counter shows before the
 * link is typed, and what a send would never do (the pass refuses a missing
 * url before it gets here).
 */
export function composeReviewRequestSms(body: string, reviewUrl: string): string {
  return withTrailingLink(body, reviewUrl);
}
