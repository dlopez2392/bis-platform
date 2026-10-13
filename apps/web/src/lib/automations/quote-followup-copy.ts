import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

type Lang = "en" | "es";

/**
 * One line, the brand name, and NEITHER the price NOR the deal's name. The
 * deal's `name` is the operator's internal words - "Smith reroof, maybe" -
 * the same class of leak `accounts.name` is, and the due-row has no field for
 * it, so this function could not include it if it wanted to. The price is
 * left out for the same reason a quote is a document: a number in a text
 * invites a negotiation nobody prepared for.
 *
 * `brandName` is the CUSTOMER-FACING name (the due-row carries only that).
 * Function replacement, not a plain string, for names containing `$&`.
 */
export function defaultQuoteFollowupBody(brandName: string, language: Lang = "en"): string {
  return brandName.trim()
    ? t(m, "automations.quoteFollowup.defaultBody", language, { name: brandName })
    : t(m, "automations.quoteFollowup.defaultBodyNoName", language);
}

/**
 * The email's subject, here rather than in the template, for the same reason
 * the body's blank-brand branch is here: `brandDisplayName` returns `""` for
 * an account that has never set a brand name (`branding.ts:197-199`), and a
 * template interpolating it directly would ship "About your quote from "
 * with nothing after it.
 */
export function quoteFollowupSubject(brandName: string, language: Lang = "en"): string {
  return brandName.trim()
    ? t(m, "automations.quoteFollowup.emailSubject", language, { name: brandName })
    : t(m, "automations.quoteFollowup.emailSubjectNoName", language);
}
