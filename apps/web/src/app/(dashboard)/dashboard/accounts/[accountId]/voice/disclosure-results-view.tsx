// S-47a §5.3: the agency's results card — the two halves of the TRIAL calls, booked / hung up early /
// asked for a person, never a verdict. Server-safe (NO "use client"): it renders from a plain view, never
// imports node:crypto. `disclosure-results-card.tsx` is the async server component that reads the data and
// hands this one the pure view; the skeleton here is its Suspense fallback.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DisclosureColumnView, DisclosureResultsView as DisclosureResultsViewType } from "@/lib/voice/disclosure-results";
import type { DisclosureSetting } from "@bis/db";
import type { Tr } from "@/lib/record/copy";

type HalfKey = "said" | "didnt";

/** One row of the half's own four numbers — booked/hungUp/askedPerson show "No calls yet" rather than 0%
 *  when the half has nothing counted yet (ambiguity I). */
function ResultRow({
  cell, label, value,
}: { cell: "counted" | "booked" | "hungUp" | "askedPerson"; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span data-cell={cell} className="tabular-nums text-card-foreground">{value}</span>
    </div>
  );
}

function ResultColumn({
  half, heading, view, tr,
}: { half: HalfKey; heading: string; view: DisclosureColumnView; tr: Tr }) {
  const pctText = (p: number | null) =>
    p === null ? tr.text("voice.disclosure.results.noneYet") : tr.text("voice.disclosure.results.percent", { percent: p });
  return (
    <div data-half={half} className="min-w-0 space-y-1">
      <p className="text-sm font-medium text-card-foreground">{heading}</p>
      <ResultRow cell="counted" label={tr.text("voice.disclosure.results.counted")} value={String(view.counted)} />
      <ResultRow cell="booked" label={tr.text("voice.disclosure.results.booked")} value={pctText(view.bookedPct)} />
      <ResultRow cell="hungUp" label={tr.text("voice.disclosure.results.hungUp")} value={pctText(view.hungUpPct)} />
      <ResultRow cell="askedPerson" label={tr.text("voice.disclosure.results.askedPerson")} value={pctText(view.askedPersonPct)} />
    </div>
  );
}

/**
 * The card itself. `view` is either the pure results view (loaded/empty) or `{ state: "error" }`, which
 * `disclosure-results-view.ts` never produces on its own — only `disclosure-results-card.tsx`'s catch does,
 * on a failed read. Never a verdict (rule 11: no hero, no comparative sentence) — numbers only, text-coloured.
 *
 * `setting` is the line's STORED Off / Trial / On (never the form's unsaved choice): the empty state can
 * only say the right thing when it knows it. On Trial the calls are simply still to come; on Off or On no
 * trial is running, so it says what appears here and the one action that causes it (rule 5). `retryHref`
 * is the page's own URL with its query (?from=, ?locale=), so Retry never drops the reader's context.
 */
export function DisclosureResultsView({
  view, tr, setting, retryHref,
}: { view: DisclosureResultsViewType | { state: "error" }; tr: Tr; setting: DisclosureSetting; retryHref: string }) {
  const footnote = view.state !== "error" && view.notCounted > 0 ? (
    <p className="text-xs text-muted-foreground">
      {tr.count("voice.disclosure.results.notCounted", view.notCounted)}
    </p>
  ) : null;
  return (
    <Card data-disclosure-results lang={tr.locale}>
      <CardHeader>
        <CardTitle>{tr.text("voice.disclosure.results.title")}</CardTitle>
        <CardDescription>{tr.text("voice.disclosure.results.period")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {view.state === "error" ? (
          <>
            <p className="text-sm text-muted-foreground">{tr.text("voice.disclosure.results.error")}</p>
            {/* Ghost only — this card carries no primary (rule 8: the profile
                card's Save is this page's one primary). */}
            <Button asChild variant="ghost" size="sm">
              <Link href={retryHref}>{tr.text("common.retry")}</Link>
            </Button>
          </>
        ) : view.state === "empty" ? (
          <>
            {setting === "trial" ? (
              <>
                <p className="text-sm text-muted-foreground">{tr.text("voice.disclosure.results.empty")}</p>
                <p className="text-sm text-muted-foreground">{tr.text("voice.disclosure.results.emptyAction")}</p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{tr.text("voice.disclosure.results.emptyIdle")}</p>
                <p className="text-sm text-muted-foreground">{tr.text("voice.disclosure.results.emptyIdleAction")}</p>
              </>
            )}
            {footnote}
          </>
        ) : (
          <>
            {/* One column below sm: two side by side ran the styleguide 19px past a 375px viewport. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ResultColumn half="said" heading={tr.text("voice.disclosure.results.said")} view={view.said} tr={tr} />
              <ResultColumn half="didnt" heading={tr.text("voice.disclosure.results.didnt")} view={view.didnt} tr={tr} />
            </div>
            {view.notEnough ? (
              <p className="text-sm text-muted-foreground">{tr.text("voice.disclosure.results.notEnough")}</p>
            ) : null}
            {footnote}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DisclosureResultsSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-4 w-full" />)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
