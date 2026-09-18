import Link from "next/link";
import type { ScreenedCallRow, ScreenedClass } from "@bis/db";
import { screenedClass } from "@bis/db";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ListPanel } from "@/components/ui/list-panel";
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

const HEAD = "px-5";
const CELL = "px-5 py-3";

export function ScreenedTable({
  rows, total, misconfiguredCount, accountsById, agencyZone, olderHref,
}: {
  rows: ScreenedCallRow[];
  /** The REAL total across every page — never `rows.length`. */
  total: number;
  /** The REAL misconfigured total across every page (`countMisconfiguredScreenedCalls`)
   *  — never `rows.filter(...)`, which only ever sees the page in hand. */
  misconfiguredCount: number;
  /** accountId → the account's own label and a ZONE already resolved by the
   *  page through `resolveZone` — never the raw `accounts.timezone` column,
   *  which is free text a pre-#89 row can hold a value `Intl` cannot format. */
  accountsById: Map<string, { name: string; zone: string }>;
  /** The agency's own zone (lib/zone.ts, resolved ONCE by the page) — what a
   *  row with no account (`unknown-number`) renders its "When" column in,
   *  since that row has no account zone of its own to claim. Never a bare
   *  "UTC" literal — this is the resolved answer, guessed or not. */
  agencyZone: string;
  olderHref?: string;
}) {
  // DESIGN.md rule 1 — the total never ships alone. The breakdown is the ONE
  // class an operator must act on (see CLASS_DOT's own comment): `screened`
  // is the system working and `unattributed` is nobody's problem, but
  // `misconfigured` means a line is turning callers away because of
  // something on our end. `misconfiguredCount` is a PROP — the real
  // cross-page count from `countMisconfiguredScreenedCalls` — never
  // `rows.filter(...)`, which is scoped to the 50 rows on this page and
  // would silently understate the breakdown on every page after the first
  // (the exact defect a paged list's "real total, not the number on
  // screen" rule, DESIGN.md, exists to forbid).
  const totalLabel = total === 1 ? m["screened.totalOne"] : m["screened.total"].replace("{n}", String(total));
  const misconfiguredLabel = misconfiguredCount === 1
    ? m["screened.misconfiguredOne"]
    : m["screened.misconfigured"].replace("{n}", String(misconfiguredCount));

  return (
    <section className="space-y-3">
      {/* DESIGN.md's Label role: Geist Mono 500, 10px, +0.14em, uppercase. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        <span>{totalLabel}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-[7px] shrink-0 rounded-full", CLASS_DOT.misconfigured)} aria-hidden />
          {misconfiguredLabel}
        </span>
      </p>

      <ListPanel>
        <Table>
          {/* No detail route exists for a screened call — there is nowhere
              for a click to go — so the interactive hover every other table
              carries is suppressed EXPLICITLY on every row, the same way
              calls-table.tsx opts its own header row out. A false hover
              affordance on a row that goes nowhere would be worse than no
              hover at all. */}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>{m["screened.col.when"]}</TableHead>
              <TableHead className={HEAD}>{m["screened.col.account"]}</TableHead>
              <TableHead className={HEAD}>{m["screened.col.called"]}</TableHead>
              <TableHead className={HEAD}>{m["screened.col.caller"]}</TableHead>
              <TableHead className={HEAD}>{m["screened.col.reason"]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const account = r.accountId ? accountsById.get(r.accountId) : undefined;
              const cls = screenedClass(r.reason);
              return (
                <TableRow key={r.id} className="hover:bg-transparent">
                  <TableCell className={cn(CELL, "tabular-nums text-muted-foreground")}>
                    {/* The account's OWN zone where there is one, already
                        resolved by the page; the agency's own, resolved
                        once by the page, where there is not — never the raw
                        `accounts.timezone` column and never a bare "UTC"
                        standing in unexplained. */}
                    {formatCallTime(r.createdAt, account?.zone ?? agencyZone)}
                  </TableCell>
                  <TableCell className={CELL}>{account?.name ?? m["screened.noAccount"]}</TableCell>
                  <TableCell className={cn(CELL, "tabular-nums")}>{r.calledE164}</TableCell>
                  <TableCell className={cn(CELL, "tabular-nums")}>
                    {r.callerE164 ?? m["screened.unknownCaller"]}
                  </TableCell>
                  <TableCell className={CELL}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-[7px] shrink-0 rounded-full", CLASS_DOT[cls])} aria-hidden />
                      {m[`screened.reason.${r.reason}` as const]}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* EXACTLY ONE pager, and only when a full page came back. */}
        {olderHref ? (
          <div className="border-t border-[var(--row-line)] px-5 py-3">
            <Link href={olderHref} className="text-sm underline underline-offset-2">
              {m["screened.older"]}
            </Link>
          </div>
        ) : null}
      </ListPanel>
    </section>
  );
}
