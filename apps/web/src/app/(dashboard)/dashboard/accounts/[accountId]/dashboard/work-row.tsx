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
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * `total` and `overdue` are already-bucketed counts (page.tsx sums
 * `BucketedWork`'s three arrays and reads `overdue.length` — this function
 * does not bucket anything itself, per the brief: get the count from the
 * bucketing already built, not a second way to compute it).
 *
 * `locale` (coordinator follow-up, S-10 lane A): optional, default "en".
 * `work.title`/`work.empty`/`work.row.*` have no `.es` twin on THIS
 * branch yet — lane B (feat/s10-contacts) owns and adds them — so a
 * Spanish request falls back to the same English text, `t()`'s own
 * documented behavior for a missing twin. That fallback is correct until
 * lane B merges, not a bug to work around here.
 */
export function workRowText(total: number, overdue: number, locale: Locale = "en"): string {
  if (total === 0) return t(m, "work.empty", locale);
  // A whole-phrase pick by count, never the plural template reused for
  // one — see work.row.countOne's own comment in messages.ts for the bug
  // this avoids (the same shape as contacts.count/contacts.countOne).
  // `work.row.count`/`work.row.countOne` is already the base/One pair
  // `plural()` expects.
  const base = plural(m, "work.row.count", total, locale, { count: total });
  if (overdue === 0) return base;
  return `${base} · ${t(m, "work.row.overdue", locale, { count: overdue })}`;
}

export function WorkRowCard({
  accountId,
  total,
  overdue,
  locale = "en",
}: {
  accountId: string;
  total: number;
  overdue: number;
  locale?: Locale;
}) {
  const countText = workRowText(total, overdue, locale);
  const title = t(m, "work.title", locale);

  return (
    <Link
      href={`/dashboard/accounts/${accountId}/tasks`}
      aria-label={`${title} (${countText})`}
      lang={locale}
      // Same clickable-card language as the agency's own accounts grid
      // (accounts/page.tsx), via checklist-row.tsx's precedent.
      className="block max-w-2xl rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3 transition-colors hover:border-[var(--accent)]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-card-foreground">{title}</span>
        {/* Purely decorative — the Link's own aria-label above already
            carries the count in words, and an explicit aria-label on the
            Link overrides name-from-content entirely, so the visible spans
            need no aria-hidden of their own (same reasoning as
            checklist-row.tsx). */}
        {/* F-107 (rider part): no `shrink-0` — `work.empty`'s own sentence
            ("Nothing needs you right now.") has no width cap and nothing
            forcing it narrower, so at phone width it held this row open
            past the card; without shrink-0 it can wrap like ordinary text
            once squeezed, same as the short count's own words would. */}
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{countText}</span>
      </span>
    </Link>
  );
}
