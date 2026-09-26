import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";

/**
 * The payment-failed banner (spec section 5; plan G21). Mounted by the
 * account layout on every page of an account whose subscription is unpaid.
 * role="note", not the Notice default "alert": a standing fact, not an event
 * (LineDownBanner's reasoning). The sentence is the marker, never the tint
 * alone (DESIGN rule 3). The paused banner is PR-4's.
 */
export function BillingBanner({ audience, accountId }: { audience: "client" | "agency"; accountId: string }) {
  const client = audience === "client";
  const href = client ? `/dashboard/accounts/${accountId}/billing` : `/dashboard/accounts/${accountId}/settings#billing`;
  return (
    <Notice tone="crit" role="note" className="text-foreground">
      {client ? m["billing.banner.client"] : m["billing.banner.agency"]}{" "}
      <Link href={href} className="underline underline-offset-2">
        {client ? m["billing.banner.clientAction"] : m["billing.banner.agencyAction"]}
      </Link>
    </Notice>
  );
}
