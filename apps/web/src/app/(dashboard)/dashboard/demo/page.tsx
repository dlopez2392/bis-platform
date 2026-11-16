// F-140 slice 1: the agency's prospect demo. On a sales visit the agency types the prospect's business in,
// hands over the device, and the prospect hears Sofía answer as their business. Nothing is stored about
// the prospect; the only write is the agency-only row the cap counts (actions.ts).
//
// requireAgency() is the literal first line: the nav lists this page for the agency only, but hiding a
// link is not authorization, and the action behind the form checks again on its own.
import { PageHeader } from "@/components/page-header";
import { requireAgency } from "@/lib/auth";
import { m } from "@/lib/messages";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import type { TradeSetup } from "@/components/vetting/trade-fields";
import { startProspectDemoAction } from "./actions";
import { ProspectDemo } from "./prospect-demo";

export const dynamic = "force-dynamic";

export default async function ProspectDemoPage() {
  await requireAgency();
  // English, like every agency-only page (layout.tsx); Sofía herself speaks the language chosen in the form.
  const trade: TradeSetup = {
    groups: tradeOptionGroups("en"),
    copy: {
      label: m["prospectDemo.field.trade"], placeholder: m["prospectDemo.field.tradePlaceholder"],
      hint: m["prospectDemo.field.tradeHint"], otherLabel: m["prospectDemo.field.tradeOther"], otherHint: m["vetting.other.hint"],
    },
    locale: "en",
  };
  return (
    <>
      <PageHeader title={m["prospectDemo.title"]} subtitle={m["prospectDemo.subtitle"]} />
      <div className="p-6">
        <ProspectDemo trade={trade} start={startProspectDemoAction} />
      </div>
    </>
  );
}
