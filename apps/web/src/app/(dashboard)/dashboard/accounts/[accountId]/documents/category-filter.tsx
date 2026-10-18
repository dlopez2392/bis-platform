"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Radix refuses an empty item value, so Any travels as its own word; the page's options keep "" for it. */
export const ANY_CATEGORY = "any";

/** The href a committed choice navigates to (built on the server, so a filter change drops the cursor); null for an unknown value. */
export function categoryCommit(options: { value: string; href: string }[], chosen: string): string | null {
  const value = chosen === ANY_CATEGORY ? "" : chosen;
  return options.find((o) => o.value === value)?.href ?? null;
}

/**
 * The page's category select (spec 3.1; review I1): the house Radix Select, so a choice is COMMITTED
 * (click or Enter) and arrowing through the list never navigates. The shown value is held here while the
 * server round trip runs, and re-seeded when the page's own `current` changes (a pill, Back, a new URL).
 */
export function CategoryFilter({ label, current, options }: {
  label: string; current: string; options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  const labelId = useId();
  const [shown, setShown] = useState(current);
  const [seed, setSeed] = useState(current);
  // React's "adjust state when a prop changes", during render, never in an effect.
  if (seed !== current) { setSeed(current); setShown(current); }
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span id={labelId}>{label}</span>
      <Select value={shown || ANY_CATEGORY} onValueChange={(v) => {
        const href = categoryCommit(options, v);
        if (!href) return;
        setShown(v === ANY_CATEGORY ? "" : v);
        router.push(href);
      }}>
        <SelectTrigger aria-labelledby={labelId} className="min-h-11 text-foreground md:min-h-8">
          <SelectValue>{options.find((o) => o.value === shown)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value || ANY_CATEGORY} value={o.value || ANY_CATEGORY}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
