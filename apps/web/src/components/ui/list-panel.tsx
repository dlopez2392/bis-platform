import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The list-card idiom, once. Six panels (forms, blueprints, conversations,
 * contacts, calls, pipeline columns) each carried their own
 * `divide-y divide-border overflow-hidden rounded-lg border border-border
 * bg-card` — flat, 11px, and ruled with `--line` (.08), a third stronger than
 * the mockup's row rule.
 *
 * `bg-card` BEFORE `glass`, the same order `ui/card.tsx` uses and
 * `material.test.ts` pins: a tenant's own `--card` still wins the fill, and
 * the utility adds only the sheen, the 1px highlight and `--shadow-card`.
 */
export const LIST_PANEL = "overflow-hidden rounded-xl border border-border bg-card glass";

/** The row inside it: a rule, never a box, and never on the first row
 *  (the panel's own border is already there). */
export const LIST_ROW = "border-t border-[var(--row-line)] first:border-t-0";

/** `as` because the six call sites are genuinely different elements — a
 *  `<ul>` of forms, a `<nav>` of conversations, a `<div>` wrapping a table —
 *  and forcing them all into a div would cost the semantics the rows rely on.
 *  Props are typed per tag rather than as `div` props so `ref` stays honest. */
type ListPanelTag = "div" | "ul" | "nav" | "section";

export function ListPanel<T extends ListPanelTag = "div">({
  as,
  className,
  ...props
}: { as?: T; className?: string } & Omit<React.ComponentProps<T>, "as" | "className">) {
  // `React.ElementType`, not the tag union: JSX intersects the props of every
  // member of a union tag, and `HTMLUListElement` has no `align`, so the
  // union form cannot typecheck at all.
  const Tag = (as ?? "div") as React.ElementType;
  return <Tag data-slot="list-panel" className={cn(LIST_PANEL, className)} {...props} />;
}
