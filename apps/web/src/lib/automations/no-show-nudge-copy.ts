import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { withTrailingLink } from "./sms-link";

type Lang = "en" | "es";

/**
 * What a customer receives when the operator has not written their own
 * nudge. `brandName` is the CUSTOMER-FACING name (brandDisplayName in
 * @bis/db) — the due-row carries only that. Blank name: the identifying
 * clause is dropped, never replaced with an invented noun. Function
 * replacement, not a plain string: a name containing `$&` would otherwise
 * be re-interpreted by String.replace.
 */
export function defaultNoShowNudgeBody(brandName: string, language: Lang = "en"): string {
  return brandName.trim()
    ? t(m, "automations.noShow.defaultBody", language, { name: brandName })
    : t(m, "automations.noShow.defaultBodyNoName", language);
}

/** The nudge's name for withTrailingLink: the settings counter and the pass
 *  both call it with the account's booking-page link. */
export function composeNoShowNudgeSms(body: string, bookingUrl: string): string {
  return withTrailingLink(body, bookingUrl);
}
