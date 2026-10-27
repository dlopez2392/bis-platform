"use client";

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { TradeOptionGroup } from "@/lib/vetting/copy";

/** DESIGN.md's Label role: group headers are mono, 10px, +0.14em, uppercase. */
const GROUP_LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/**
 * The grouped trade Select (S-53; the first SelectGroup/SelectLabel use in the app - styleguide entry
 * "Trade picker"). Controlled, so the Other description can appear beside it; posted as `name` through
 * Radix's hidden native select. Every form that holds it submits via useFormSubmit, never `action`
 * (lib/forms/use-form-submit.ts: React's post-action reset drives a Radix Select backwards).
 */
export function TradePicker({
  id, name, groups, value, onValueChange, placeholder,
}: {
  id: string;
  name: string;
  groups: TradeOptionGroup[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Select name={name} value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
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
