"use client";

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Locale } from "@/lib/i18n/locale";
import type { TradeOptionGroup } from "@/lib/vetting/copy";

/** DESIGN.md's Label role: group headers are mono, 10px, +0.14em, uppercase. */
const GROUP_LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/** The trigger lets a long trade wrap (design check M3: "Construcción y remodelación" was cut off at
 *  390px on the Settings card) instead of the shared trigger's one clamped line at a fixed 36px. */
const WRAPPING_TRIGGER =
  "w-full text-left whitespace-normal data-[size=default]:h-auto data-[size=default]:min-h-9 *:data-[slot=select-value]:line-clamp-none";

/**
 * The grouped trade Select (S-53; the first SelectGroup/SelectLabel use in the app - styleguide entry
 * "Trade picker"). Controlled, so the Other description can appear beside it; posted as `name` through
 * Radix's hidden native select. Every form that holds it submits via useFormSubmit, never `action`
 * (lib/forms/use-form-submit.ts: React's post-action reset drives a Radix Select backwards).
 * `lang` goes on the list itself: Radix portals it to the end of <body>, outside whatever `lang` the
 * form around the trigger sets (design check I1).
 */
export function TradePicker({
  id, name, groups, value, onValueChange, placeholder, locale,
}: {
  id: string;
  name: string;
  groups: TradeOptionGroup[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  locale: Locale;
}) {
  return (
    <Select name={name} value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={WRAPPING_TRIGGER}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent lang={locale}>
        {groups.map((g) => (
          <SelectGroup key={g.key}>
            <SelectLabel className={GROUP_LABEL}>{g.label}</SelectLabel>
            {g.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
