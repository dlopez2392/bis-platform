import Link from "next/link";
import { BillingPageLink } from "@/components/billing-page-link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The paused banner (spec section 5; plan G12). On every page of a paused
 * account, for every member and the agency. role="note" and the sentence is
 * the marker (DESIGN rule 3). tone crit: service is reduced right now. Its
 * words are true with or without a transfer number and on any day of the
 * pause (M3, pinned at the copy level in messages.test.ts). Three audiences:
 * the client Owner (link to Billing), Staff and Technicians (Billing is
 * Owner-only: a line instead), the agency (link to the Settings card).
 * `lang` sits on each sentence's own span (the root html stays en). The
 * agency's line is bilingual too (design review M1), the payment-failed
 * banner's rule: an operator's own chosen locale reaches it through the
 * layout. The owner's "Go to Billing" hides on the Billing page itself (M2).
 */
export function BillingPausedBanner({ audience, accountId, cause, locale }: {
  audience: "owner" | "member" | "agency"; accountId: string; cause: "payment" | "ended"; locale: Locale;
}) {
  if (audience === "agency") {
    return (
      <Notice tone="crit" role="note" className="text-foreground">
        <span lang={locale}>
          {t(m, "billing.paused.agency", locale)}{" "}
          <Link href={`/dashboard/accounts/${accountId}/settings#billing`} className="underline underline-offset-2">
            {t(m, "billing.paused.agencyAction", locale)}
          </Link>
        </span>
      </Notice>
    );
  }
  const sentence = t(m, cause === "ended" ? "billing.paused.client.ended" : "billing.paused.client.payment", locale);
  return (
    <Notice tone="crit" role="note" className="text-foreground">
      <span lang={locale}>
        {sentence}{" "}
        {audience === "owner" ? (
          <BillingPageLink href={`/dashboard/accounts/${accountId}/billing`}>
            {t(m, "billing.paused.client.action", locale)}
          </BillingPageLink>
        ) : t(m, "billing.paused.client.staff", locale)}
      </span>
    </Notice>
  );
}
