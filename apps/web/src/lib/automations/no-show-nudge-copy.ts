import { m } from "@/lib/messages";
import { withTrailingLink } from "./sms-link";

/**
 * What a customer receives when the operator has not written their own
 * nudge. `brandName` is the CUSTOMER-FACING name (brandDisplayName in
 * @bis/db) — the due-row carries only that. Blank name: the identifying
 * clause is dropped, never replaced with an invented noun. Function
 * replacement, not a plain string: a name containing `$&` would otherwise
 * be re-interpreted by String.replace.
 */
export function defaultNoShowNudgeBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.noShow.defaultBodyNoName"];
  return m["automations.noShow.defaultBody"].replace("{name}", () => brandName);
}

/** The nudge's name for withTrailingLink: the settings counter and the pass
 *  both call it with the account's booking-page link. */
export function composeNoShowNudgeSms(body: string, bookingUrl: string): string {
  return withTrailingLink(body, bookingUrl);
}
