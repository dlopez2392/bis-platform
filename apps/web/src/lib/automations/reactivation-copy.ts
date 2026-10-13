import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

type Lang = "en" | "es";

/**
 * What a past customer receives. Three things it deliberately is not: no
 * urgency, no discount, and no "we miss you". This message reaches someone
 * who has not thought about this business in nine months, and the only
 * version of it that is welcome is one that reads as a door left open.
 *
 * `brandName` is the customer-facing name; a blank one drops the clause.
 * Function replacement, not a plain string, for names containing `$&`.
 */
export function defaultReactivationBody(brandName: string, language: Lang = "en"): string {
  return brandName.trim()
    ? t(m, "automations.reactivation.defaultBody", language, { name: brandName })
    : t(m, "automations.reactivation.defaultBodyNoName", language);
}

/** Plain, the brand name, and no exclamation mark — a subject line that
 *  looks like a newsletter gets treated as one. The blank-brand branch lives
 *  here rather than in the template for the same reason the referral ask's
 *  does: `brandDisplayName` returns `""` for an account that has never set a
 *  brand name, and a template interpolating it directly would send "A note
 *  from " with nothing after it. */
export function reactivationSubject(brandName: string, language: Lang = "en"): string {
  return brandName.trim()
    ? t(m, "automations.reactivation.subject", language, { name: brandName })
    : t(m, "automations.reactivation.subjectNoName", language);
}

// The footer's first line lives in `marketing-copy.ts` as
// `marketingFooterReason` since the referral ask prints it too (B21).
