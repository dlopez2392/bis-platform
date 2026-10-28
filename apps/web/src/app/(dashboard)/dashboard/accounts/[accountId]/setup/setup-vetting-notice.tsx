import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { sofiaGate } from "@/lib/vetting/trades";

/** S-53 (spec 5.1/5.3): why Sofía's steps are missing (a CRM-only trade) or will refuse (no trade). */
export function SetupVettingNotice({ accountId, trade }: { accountId: string; trade: string | null }) {
  const gate = sofiaGate(trade);
  if (gate.ok) return null;
  if (gate.reason === "crm_only") {
    return <Notice tone="warn" className="text-foreground" data-testid="setup-vetting">{m["vetting.crmOnlyCreated"]}</Notice>;
  }
  return (
    <Notice tone="warn" className="text-foreground" data-testid="setup-vetting">
      {m["vetting.sofia.noTrade"]}{" "}
      <Link className="underline" href={`/dashboard/accounts/${accountId}/settings?from=setup#trade`}>{m["vetting.sofia.noTradeLink"]}</Link>
    </Notice>
  );
}
