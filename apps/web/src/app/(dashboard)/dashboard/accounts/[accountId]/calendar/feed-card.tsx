"use client";

// F-048 part 2: the Calendar page's "Bookings on your phone" card. The person's own private calendar link:
// make it, copy it, add it to an iPhone, replace it, turn it off, each with Undo where it can be undone
// (DESIGN.md rule 6). The view is read by page.tsx (feed-card-data.ts) and arrives with the page, so the card
// has no loading moment of its own. Type-only imports from the server files: nothing secret reaches the
// browser bundle (feed-card.test.ts pins it). Tokens only.
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/lib/format";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { FeedCardView } from "./feed-card-data";
import type { FeedActionResult, FeedUndo } from "./feed-actions";
import { runMake, runWithUndo } from "./feed-card-handlers";

type Run = () => Promise<FeedActionResult>;

export type FeedCardProps = {
  view: FeedCardView;
  locale: Locale;
  pseudo?: boolean;
  make: Run;
  replace: Run;
  turnOff: Run;
  undo: (undo: FeedUndo) => Promise<FeedActionResult>;
};

const APPS = ["iphone", "google", "outlook"] as const;

/** The catalogue writes each app's steps as one numbered sentence ("1. … 2. …"); the card lists them one per line. */
function steps(text: string): string[] {
  return text.split(/\s(?=\d\.\s)/);
}

const muted = "text-[var(--text-2)]";

export function FeedCard({ view, locale, pseudo = false, make, replace, turnOff, undo }: FeedCardProps) {
  const tr = makeTr(locale, pseudo);
  const router = useRouter();
  const refresh = () => router.refresh();
  const [pending, start] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  const go = (f: () => Promise<void>) => start(async () => { await f(); });

  const onReplace = () => go(() => runWithUndo(replace, undo, tr, "calendar.feed.toast.replaced", refresh));
  const onTurnOff = () => go(() => runWithUndo(turnOff, undo, tr, "calendar.feed.toast.turnedOff", refresh));

  return (
    <Card id="phone-calendar" data-feed-card>
      <CardHeader>
        <CardTitle>{tr.text("calendar.feed.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {view.kind === "agency" ? <p className={muted}>{tr.text("calendar.feed.agency")}</p> : null}
        {view.kind === "unavailable" ? <p className={muted}>{tr.text("calendar.feed.unavailable")}</p> : null}
        {view.kind === "error" ? <p className={muted}>{tr.text("calendar.feed.loadError")}</p> : null}

        {view.kind === "none" ? (
          <>
            <p className={muted}>{tr.text("calendar.feed.empty")}</p>
            <Button type="button" disabled={pending} onClick={() => go(() => runMake(make, tr, refresh))}>
              {tr.text("calendar.feed.make")}
            </Button>
          </>
        ) : null}

        {view.kind === "stale" ? (
          <>
            <p className={muted}>{tr.text("calendar.feed.stale")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={onReplace}>{tr.text("calendar.feed.replace")}</Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={onTurnOff}>{tr.text("calendar.feed.turnOff")}</Button>
            </div>
          </>
        ) : null}

        {view.kind === "live" ? (
          <LiveLink
            view={view} tr={tr} locale={locale} pending={pending} field={field}
            onReplace={onReplace} onTurnOff={onTurnOff}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function LiveLink({ view, tr, locale, pending, field, onReplace, onTurnOff }: {
  view: Extract<FeedCardView, { kind: "live" }>; tr: Tr; locale: Locale; pending: boolean;
  field: React.RefObject<HTMLInputElement | null>; onReplace: () => void; onTurnOff: () => void;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(view.url);
      toast.success(tr.text("calendar.feed.copied"));
    } catch {
      // No clipboard (an insecure page, a refused permission): select the link so it can be copied by hand.
      field.current?.select();
    }
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs font-medium">{tr.text("calendar.feed.linkLabel")}</p>
        <Input
          ref={field} readOnly value={view.url} aria-label={tr.text("calendar.feed.linkLabel")}
          className="font-mono" onFocus={(e) => e.currentTarget.select()}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void copy()}>{tr.text("calendar.feed.copy")}</Button>
          <Button asChild variant="ghost">
            <a href={view.webcal}>{tr.text("calendar.feed.addIphone")}</a>
          </Button>
        </div>
      </div>

      <p className={muted}>{tr.text("calendar.feed.private")}</p>
      <p className={muted}>{tr.text("calendar.feed.window")}</p>
      {view.technician ? <p className={muted}>{tr.text("calendar.feed.technician")}</p> : null}
      <p className={muted} suppressHydrationWarning>
        {view.lastFetchedAt
          ? tr.text("calendar.feed.lastChecked", { when: formatRelativeTime(view.lastFetchedAt, locale) })
          : tr.text("calendar.feed.neverChecked")}
      </p>

      <details className="rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
        <summary className="cursor-pointer font-medium">{tr.text("calendar.feed.howTo")}</summary>
        <div className="mt-3 space-y-3">
          {APPS.map((app) => (
            <div key={app}>
              <p className="font-medium">{tr.text(`calendar.feed.${app}.title`)}</p>
              <ol className={`mt-1 space-y-1 ${muted}`}>
                {steps(tr.text(`calendar.feed.${app}.steps`)).map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
          ))}
          <p className={muted}>{tr.text("calendar.feed.slow")}</p>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onReplace}>{tr.text("calendar.feed.replace")}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onTurnOff}>{tr.text("calendar.feed.turnOff")}</Button>
      </div>
    </>
  );
}
