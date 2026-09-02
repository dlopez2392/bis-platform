// apps/web/src/components/stat-tile.tsx
//
// The ONE tile component in the tree (evolves in place — never a second
// tile component). DESIGN.md rule 1: every metric ships with context — a
// delta, sparkline, or period label. A bare number is the thing this phase
// exists to kill, so `hasStatContext` is enforced below rather than left as
// a convention callers might forget.
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

export type StatTileDelta = { direction: "up" | "down" | "flat"; label: string };

/**
 * Rule 1's enforcement, pulled out as a pure predicate so it has a unit-test
 * seam that doesn't need a component-render harness — the repo has no .tsx
 * test convention today (see the Task 4 report). An empty `spark` array
 * carries no visible trend line, so it doesn't count as context any more
 * than an absent one would.
 */
export function hasStatContext({
  delta,
  spark,
  period,
}: {
  delta?: StatTileDelta;
  spark?: number[];
  period?: string;
}): boolean {
  return Boolean(delta) || Boolean(spark && spark.length > 0) || Boolean(period);
}

/** "up 12% vs the prior period" style wording — the chip's `aria-label`,
 *  spelled out in words so ▲/▼ is never the only carrier of the meaning. */
function deltaAriaLabel(delta: StatTileDelta): string {
  if (delta.direction === "flat") return m["stat.delta.flat"];
  const key = delta.direction === "up" ? "stat.delta.up" : "stat.delta.down";
  return m[key].replace("{value}", delta.label);
}

const LABEL_ROLE = "font-mono text-[10px] font-medium tracking-[0.14em] uppercase text-muted-foreground";

export function StatTile({
  label,
  value,
  delta,
  spark,
  period,
  valueTestId,
}: {
  label: string;
  value: string;
  delta?: StatTileDelta;
  spark?: number[];
  period?: string;
  /** Optional `data-testid` on the value element only — e2e's grants-proof
   *  assertion (client-access.spec.ts) needs a stable hook onto a specific
   *  tile's rendered value, since the label text alone isn't a safe
   *  Playwright selector once several tiles share this component. */
  valueTestId?: string;
}) {
  if (process.env.NODE_ENV !== "production" && !hasStatContext({ delta, spark, period })) {
    throw new Error(
      `StatTile("${label}"): every metric ships with context — pass at least one of delta, spark, or period (DESIGN.md rule 1).`,
    );
  }

  const glyph = delta ? (delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : null) : null;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className={LABEL_ROLE}>{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p
          data-testid={valueTestId}
          className="font-display font-[650] text-3xl tracking-[-0.01em] tabular-nums text-card-foreground"
        >
          {value}
        </p>
        {delta ? (
          <>
            {/* `aria-label` on a generic `<span>` is unreliable — naming is
                prohibited on the generic role for some screen-reader pairs
                (app-sidebar.tsx's SidebarLink carries the same note next to
                its own Link, which CAN carry a name, unlike this bare
                `<span>`). Hidden from assistive tech entirely; the `sr-only`
                sibling below carries the same worded copy instead. */}
            <span
              aria-hidden
              className={cn(
                "text-xs font-medium",
                delta.direction === "up" && "text-success",
                delta.direction === "down" && "text-destructive",
                delta.direction === "flat" && "text-muted-foreground",
              )}
            >
              {glyph ? `${glyph} ` : ""}
              {delta.label}
            </span>
            <span className="sr-only">{deltaAriaLabel(delta)}</span>
          </>
        ) : null}
      </div>
      {spark && spark.length > 0 ? (
        <div className="mt-3 h-[26px] text-primary">
          <Sparkline counts={spark} className="h-full w-full" />
        </div>
      ) : null}
      {period ? <p className={cn(LABEL_ROLE, "mt-2")}>{period}</p> : null}
    </div>
  );
}
