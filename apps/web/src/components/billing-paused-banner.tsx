import Link from "next/link";
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
 * `lang` sits on the client sentence's own span (the root html stays en);
 * the agency's line is always English, by design, like the work queue's
 * billing banner — so it carries no lang override.
 */
export function BillingPausedBanner({ audience, accountId, cause, locale }: {
  audience: "owner" | "member" | "agency"; accountId: string; cause: "payment" | "ended"; locale: Locale;
}) {
  if (audience === "agency") {
    return (
      <Notice tone="crit" role="note" className="text-foreground">
        {m["billing.paused.agency"]}{" "}
        <Link href={`/dashboard/accounts/${accountId}/settings#billing`} className="underline underline-offset-2">
          {m["billing.paused.agencyAction"]}
        </Link>
      </Notice>
    );
  }
  const sentence = t(m, cause === "ended" ? "billing.paused.client.ended" : "billing.paused.client.payment", locale);
  return (
    <Notice tone="crit" role="note" className="text-foreground">
      <span lang={locale}>
        {sentence}{" "}
        {audience === "owner" ? (
          <Link href={`/dashboard/accounts/${accountId}/billing`} className="underline underline-offset-2">
            {t(m, "billing.paused.client.action", locale)}
          </Link>
        ) : t(m, "billing.paused.client.staff", locale)}
      </span>
    </Notice>
  );
}
