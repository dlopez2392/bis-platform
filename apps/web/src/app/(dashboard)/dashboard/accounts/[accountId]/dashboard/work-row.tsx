// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/work-row.tsx
//
// The dashboard's compact stand-in for the full /tasks "To do" screen (Task
// 5) — how much is waiting, and one link to go do it. Same shape as
// checklist-row.tsx, whose header comment this one restates rather than
// just copying the markup:
//
// - ONE `Link` wraps the whole row; the whole row is the click target.
// - The accessible name goes in an `aria-label` ON THE LINK, not a labelled
//   span inside it — an explicit label on the link overrides name-from-
//   content entirely, so a carefully written inner span would be silently
//   dropped (checklist-row.tsx's own stated rule).
// - Card affordance borrowed from the same place checklist-row's is: the
//   accounts grid's "block card, hover:border accent" language.
// - The count takes the mono label role with tabular numerals.
//
// Unlike ChecklistRow this row never disappears (spec §4.3): a queue that
// reaches zero still renders, with `work.empty`'s own sentence, so the row
// reads as "nothing to do right now" rather than as a missing feature. No
// meter/bar here — there is no fraction-of-a-whole to show, only a count —
// so meter.tsx's shared tokens don't apply to this particular row.
import Link from "next/link";
import { m } from "@/lib/messages";

/**
 * `total` and `overdue` are already-bucketed counts (page.tsx sums
 * `BucketedWork`'s three arrays and reads `overdue.length` — this function
 * does not bucket anything itself, per the brief: get the count from the
 * bucketing already built, not a second way to compute it).
 */
export function workRowText(total: number, overdue: number): string {
  if (total === 0) return m["work.empty"];
  // A whole-phrase pick by count, never the plural template reused for
  // one — see work.row.countOne's own comment in messages.ts for the bug
  // this avoids (the same shape as contacts.count/contacts.countOne).
  const base = total === 1 ? m["work.row.countOne"] : m["work.row.count"].replace("{count}", String(total));
  if (overdue === 0) return base;
  return `${base} · ${m["work.row.overdue"].replace("{count}", String(overdue))}`;
}

export function WorkRowCard({
  accountId,
  total,
  overdue,
}: {
  accountId: string;
  total: number;
  overdue: number;
}) {
  const countText = workRowText(total, overdue);

  return (
    <Link
      href={`/dashboard/accounts/${accountId}/tasks`}
      aria-label={`${m["work.title"]} (${countText})`}
      // Same clickable-card language as the agency's own accounts grid
      // (accounts/page.tsx), via checklist-row.tsx's precedent.
      className="block max-w-2xl rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3 transition-colors hover:border-[var(--accent)]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-card-foreground">{m["work.title"]}</span>
        {/* Purely decorative — the Link's own aria-label above already
            carries the count in words, and an explicit aria-label on the
            Link overrides name-from-content entirely, so the visible spans
            need no aria-hidden of their own (same reasoning as
            checklist-row.tsx). */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{countText}</span>
      </span>
    </Link>
  );
}
