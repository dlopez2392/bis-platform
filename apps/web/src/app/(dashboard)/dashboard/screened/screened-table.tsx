import Link from "next/link";
import type { ScreenedCallRow, ScreenedClass } from "@bis/db";
import { screenedClass } from "@bis/db";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
// Reused, not duplicated — the same "one place, not eight tables drifting"
// rule `OUTCOMES` (that file's own doc comment) already established, and the
// exact "when" treatment (weekday/month/day/year + short zone name) the
// Calls list renders.
import { formatCallTime } from "../accounts/[accountId]/calls/format";

/**
 * Hue by CLASS, never by reason — three classes, three treatments, and the
 * WORD beside the dot is what says which of the six reasons it is.
 *
 * `misconfigured` takes the warning hue because it is the only one an
 * operator must act on. `screened` recedes: the system worked. `unattributed`
 * recedes furthest — a wrong number is nobody's problem.
 *
 * Exported (this module carries no "use client" boundary, unlike
 * setup-rail.tsx) so the styleguide's "Screened reasons" section reads the
 * three treatments straight off this map rather than a second copy that
 * could drift from it.
 */
export const CLASS_DOT: Record<ScreenedClass, string> = {
  misconfigured: "bg-[var(--warn)]",
  screened: "bg-muted-foreground/60",
  unattributed: "bg-muted-foreground/30",
};

const LABEL_ROLE =
  "font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase";

export function ScreenedTable({
  rows, total, accountsById, agencyZone, olderHref,
}: {
  rows: ScreenedCallRow[];
  /** The REAL total across every page — never `rows.length`. */
  total: number;
  accountsById: Map<string, { name: string; timezone: string }>;
  /** The agency's own zone (lib/zone.ts, resolved ONCE by the page) — what a
   *  row with no account (`unknown-number`) renders its "When" column in,
   *  since that row has no account zone of its own to claim. Never a bare
   *  "UTC" literal — this is the resolved answer, guessed or not. */
  agencyZone: string;
  olderHref?: string;
}) {
  return (
    <section className="space-y-3">
      <p className={LABEL_ROLE}>{m["screened.total"].replace("{n}", String(total))}</p>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.when"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.account"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.called"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.caller"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.reason"]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const account = r.accountId ? accountsById.get(r.accountId) : undefined;
              const cls = screenedClass(r.reason);
              return (
                <tr key={r.id} className="border-t border-[var(--row-line)]">
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">
                    {/* The account's OWN zone where there is one; the
                        agency's own, resolved once by the page, where there
                        is not — never a bare "UTC" standing in unexplained. */}
                    {formatCallTime(r.createdAt, account?.timezone ?? agencyZone)}
                  </td>
                  <td className="px-5 py-3">{account?.name ?? m["screened.noAccount"]}</td>
                  <td className="px-5 py-3 tabular-nums">{r.calledE164}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {r.callerE164 ?? m["screened.unknownCaller"]}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-[7px] shrink-0 rounded-full", CLASS_DOT[cls])} aria-hidden />
                      {m[`screened.reason.${r.reason}` as const]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* EXACTLY ONE pager, and only when a full page came back. */}
      {olderHref ? (
        <Link href={olderHref} className="text-sm underline underline-offset-2">
          {m["screened.older"]}
        </Link>
      ) : null}
    </section>
  );
}
