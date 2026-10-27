"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/lib/i18n/locale";
import type { TradeOptionGroup } from "@/lib/vetting/copy";
import { TRADE_OTHER_MAX } from "@/lib/vetting/trades";
import { TradePicker } from "./trade-picker";

export type TradeFieldsCopy = { label: string; placeholder: string; hint: string; otherLabel: string; otherHint: string };
/** What a server page resolves once and hands to a dialog or card that records a trade. */
export type TradeSetup = { groups: TradeOptionGroup[]; copy: TradeFieldsCopy; locale: Locale };

/**
 * The Trade field and, for Other, the required one-line description (spec 5.1, V2). Shared by Add
 * company, Add as a company and the Settings Trade card. `lang` is set because these surfaces render in
 * the operator's language while the page around them may not (DoD: sets lang correctly). The hidden
 * `locale` input travels with the fields, so every form that records a trade gets its refusal back in
 * the language the fields were read in (the server actions read it; final review M3). `onTradeChange`
 * lets a form drop a refusal that was about the trade it no longer shows (design check M2).
 */
export function TradeFields({
  idPrefix, groups, copy, locale, defaultTrade = "", defaultOther = "", onTradeChange,
}: TradeSetup & { idPrefix: string; defaultTrade?: string; defaultOther?: string; onTradeChange?: (trade: string) => void }) {
  const [trade, setTrade] = useState(defaultTrade);
  const pickerId = `${idPrefix}-trade`;
  const otherId = `${idPrefix}-trade-other`;
  return (
    <div lang={locale} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-1.5">
        <Label htmlFor={pickerId}>{copy.label}</Label>
        <TradePicker
          id={pickerId} name="trade" groups={groups} value={trade} placeholder={copy.placeholder} locale={locale}
          onValueChange={(v) => { setTrade(v); onTradeChange?.(v); }}
        />
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </div>
      {trade === "other" ? (
        <div className="space-y-1.5">
          <Label htmlFor={otherId}>{copy.otherLabel}</Label>
          <Input id={otherId} name="tradeOther" required maxLength={TRADE_OTHER_MAX} defaultValue={defaultOther} />
          <p className="text-xs text-muted-foreground">{copy.otherHint}</p>
        </div>
      ) : null}
    </div>
  );
}
