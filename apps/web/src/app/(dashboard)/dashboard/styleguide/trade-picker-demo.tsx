"use client";

import { TradeFields } from "@/components/vetting/trade-fields";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/** The grouped trade Select (S-53), in English and Spanish, and with Other's description open. */
export function TradePickerDemo() {
  const copy = (locale: "en" | "es") => ({
    label: t(m, "vetting.trade.label", locale), placeholder: t(m, "vetting.trade.placeholder", locale),
    hint: t(m, "vetting.trade.hint", locale), otherLabel: t(m, "vetting.other.label", locale), otherHint: t(m, "vetting.other.hint", locale),
  });
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2" data-testid="styleguide-trade-picker">
      <TradeFields idPrefix="sg-en" groups={tradeOptionGroups("en")} copy={copy("en")} locale="en" />
      <TradeFields idPrefix="sg-es" groups={tradeOptionGroups("es")} copy={copy("es")} locale="es" defaultTrade="other" />
    </div>
  );
}
