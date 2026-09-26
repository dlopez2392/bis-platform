import { m } from "@/lib/messages";

/**
 * The CLIENT's word for a first payment still going through (`incomplete`).
 * G13 files it under "Payment failed", which the agency card keeps (it has
 * the context), but to a client paying right now that word is false: G21
 * keeps the banner off for the same reason. The Billing page overrides only
 * this case; every other status reads BILLING_STATUS_TREATMENTS unchanged.
 * Token classes only: the Link-sent treatment's own, a dot AND a word.
 */
export const PAYMENT_PROCESSING = {
  label: m["billing.page.status.processing"],
  dot: "bg-warning",
  chip: "border-warning/30 bg-warning/10 text-foreground",
} as const;
