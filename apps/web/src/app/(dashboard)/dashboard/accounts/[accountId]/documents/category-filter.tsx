"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/** The page's category select (spec 3.1): a change navigates to the server-built href for that choice; a filter change drops the cursor. */
export function CategoryFilter({ label, current, options }: {
  label: string; current: string; options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{label}</span>
      <select value={current} onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) router.push(o.href); }}
        className={cn("min-h-11 rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 text-sm text-foreground md:min-h-8",
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
