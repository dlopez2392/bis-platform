import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The Billing PAGE's word for a first payment still going through
 * (`incomplete`). G13 files that state under "Payment failed", but to a
 * client paying right now that word is false (G21 keeps the banner off for
 * the same reason).
 *
 * This route shows the CLIENT's words to whoever opens it, the agency
 * included: an agency user inside the account sees the page exactly as the
 * client does, deliberately, so it is not gated on isAgency. The agency's
 * OWN view of billing is the Settings Billing card (Task 9), which reads
 * BILLING_STATUS_TREATMENTS unchanged and keeps G13's "Payment failed".
 * Only this one case is overridden here; every other status on the page
 * reads BILLING_STATUS_TREATMENTS too.
 *
 * Token classes only: the Link-sent treatment's own, a dot AND a word.
 *
 * S-10 T6: was a module-level English constant (this PAGE's only reader);
 * now a function of the reader's own locale, same shape as billing-view.ts's
 * `billingStatusTreatment`.
 */
export function paymentProcessingTreatment(locale: Locale): { label: string; dot: string; chip: string } {
  return { label: t(m, "billing.page.status.processing", locale), dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" };
}
