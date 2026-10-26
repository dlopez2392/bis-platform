import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The payment-failed banner (spec section 5; plan G21). Mounted by the
 * account layout on every page of an account whose subscription is unpaid.
 * role="note", not the Notice default "alert": a standing fact, not an event
 * (LineDownBanner's reasoning). The sentence is the marker, never the tint
 * alone (DESIGN rule 3). The paused banner is PR-4's.
 *
 * Bilingual (PR-4 Task 10): all four keys go through t(), inside a
 * `<span lang={locale}>` — the same placement the paused banner uses, never
 * on the Notice itself, which also carries the link. The agency audience is
 * bilingual too: an agency operator's OWN chosen locale (mis preferencias)
 * still wins even inside a client's account (the layout's own locale already
 * encodes that split; this component just renders whatever it is given).
 */
export function BillingBanner({ audience, accountId, locale }: { audience: "client" | "agency"; accountId: string; locale: Locale }) {
  const client = audience === "client";
  const href = client ? `/dashboard/accounts/${accountId}/billing` : `/dashboard/accounts/${accountId}/settings#billing`;
  return (
    <Notice tone="crit" role="note" className="text-foreground">
      <span lang={locale}>
        {client ? t(m, "billing.banner.client", locale) : t(m, "billing.banner.agency", locale)}{" "}
        <Link href={href} className="underline underline-offset-2">
          {client ? t(m, "billing.banner.clientAction", locale) : t(m, "billing.banner.agencyAction", locale)}
        </Link>
      </span>
    </Notice>
  );
}
