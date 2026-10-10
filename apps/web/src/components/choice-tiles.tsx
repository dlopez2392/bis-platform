"use client";

import { cn } from "@/lib/utils";

/**
 * A radio group drawn as choice tiles: one decision, every option visible,
 * one click to change. Native `<input type="radio">` inside a `<fieldset>`,
 * so the browser owns the keyboard (Tab into the group, arrows move and
 * select, Space selects) and a screen reader hears the legend and "1 of 3".
 *
 * The tile is the label, so the whole tile is the click target. Tokens
 * only: `--surface-2` at rest (a nested panel on a card), `--surface-3` on
 * hover over 150ms, `--accent-dim` and `--line-strong` when checked, the
 * control radius, and the house focus ring (nativeFieldClass's
 * `--ring-glow`) drawn on the TILE when its radio has keyboard focus.
 *
 * `value` may be null: a group with nothing chosen yet shows no tile
 * checked (the agency's language before it picks one) instead of pretending
 * a choice was made. Controlled, and no `<form>`: each change is the
 * caller's to apply at once (DESIGN.md rule 6).
 */
export function ChoiceTiles<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  hint,
  className,
}: {
  name: string;
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  /** One line under the group: what the empty state means, or what an option resolves to. */
  hint?: string;
  className?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <fieldset role="radiogroup" aria-describedby={hintId} className={cn("min-w-0 space-y-2", className)}>
      <legend className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">
        {legend}
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-ctl)] border border-[var(--line)] px-3 py-2 text-sm text-[var(--text-1)]",
              "bg-[var(--surface-2)] transition-colors duration-150 motion-reduce:transition-none hover:bg-[var(--surface-3)]",
              "has-checked:border-[var(--line-strong)] has-checked:bg-[var(--accent-dim)] has-checked:font-medium",
              "has-focus-visible:ring-[3px] has-focus-visible:ring-[var(--ring-glow)] has-focus-visible:border-[var(--accent)]",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 shrink-0 accent-[var(--accent)] outline-none"
            />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-[var(--text-2)]">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
