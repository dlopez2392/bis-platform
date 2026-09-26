import { m } from "@/lib/messages";

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
 */
export const PAYMENT_PROCESSING = {
  label: m["billing.page.status.processing"],
  dot: "bg-warning",
  chip: "border-warning/30 bg-warning/10 text-foreground",
} as const;
