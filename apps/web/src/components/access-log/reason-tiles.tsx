import type { AgencyVisitReason } from "@bis/db";
import { cn } from "@/lib/utils";

/**
 * F-118 part 1 (spec 3.2): the chooser's four reason tiles. Server-safe (no `"use client"`): each tile
 * is a plain `<button type="submit" name="reason" value="…">` inside the caller's own `<form>`, so a tap
 * posts `startVisitAction` directly with no client-side state. Copies `components/choice-tiles.tsx:52-58`'s
 * token recipe on a `<button>` instead of a radio `<label>` — `--surface-2` at rest, `--surface-3` on
 * hover over 150ms, `--line`/`--line-strong`, `--radius-ctl`, `min-h-11`, the `--ring-glow` focus ring.
 * All four tiles are the same size and none is primary (rule 8 as amended 2026-10-29: a chooser of
 * mutually exclusive single-step actions carries no primary). The label wraps inside the tile
 * (`min-w-0 break-words`, choice-tiles.tsx's own span) so a long or pseudo-locale label never overflows.
 */
export function ReasonTiles({
  legend, options,
}: {
  legend: string;
  options: readonly { value: AgencyVisitReason; label: string }[];
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">
        {legend}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="submit"
            name="reason"
            value={option.value}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-[var(--radius-ctl)] border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--text-1)]",
              "bg-[var(--surface-2)] transition-colors duration-150 motion-reduce:transition-none hover:bg-[var(--surface-3)] hover:border-[var(--line-strong)]",
              "outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)] focus-visible:border-[var(--accent)]",
            )}
          >
            <span className="min-w-0 break-words">{option.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
