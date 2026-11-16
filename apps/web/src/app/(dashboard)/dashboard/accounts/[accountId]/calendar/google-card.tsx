"use client";

// S-22 slice 1, PR 3: the Calendar page's "Google Calendar" card (plan D3, D8, D12, D16). Connect it so the times
// the owner is busy on Google are not offered to customers. The view is read by the page (google-card-data.ts)
// and arrives whole: the card's own loading moment is the skeleton below, its own error state is `error`.
// Connect and Reconnect are a plain <a href>, never a prefetching <Link>: the route sets a cookie and redirects
// off site. Disconnect runs at once with NO Undo (it would need the revoked token back: DESIGN.md rule 6's
// "Change PIN" case) and says what happens next in its toast. One primary per state (rule 8). Tokens only.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { formatRelativeTime } from "@/lib/format";
import { makeTr, type Tr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { runGoogleDisconnect, type GoogleCardView, type GoogleConnectOffer } from "./google-card-data";
import type { GoogleDisconnectResult } from "./google-actions";

export type GoogleCardProps = {
  view: GoogleCardView;
  locale: Locale;
  pseudo?: boolean;
  disconnect: () => Promise<GoogleDisconnectResult>;
};

const muted = "text-[var(--text-2)]";
/** An email has no break points: it wraps anywhere rather than widen the card at 375px or under the pseudo-locale. */
const EMAIL = `min-w-0 [overflow-wrap:anywhere] ${muted}`;

export function GoogleCard({ view, locale, pseudo = false, disconnect }: GoogleCardProps) {
  const tr = makeTr(locale, pseudo);
  const router = useRouter();
  const [pending, start] = useTransition();
  const { body } = view;

  // The outcome of the trip to Google is held here, not read from the URL again: `?google=` stays on the address
  // after the callback, so a refresh (Disconnect's own) would otherwise draw "connected" above Connect. Strip it
  // once on mount, and clear the line when Disconnect starts.
  const [outcome, setOutcome] = useState(view.outcome);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("google")) {
      url.searchParams.delete("google");
      window.history.replaceState(null, "", url);
    }
  }, []);

  const onDisconnect = () => start(() => runGoogleDisconnect({
    disconnect,
    clearOutcome: () => setOutcome(null),
    notify: (f) => { if (f.tone === "success") toast.success(tr.text(f.key)); else toast.error(tr.text(f.key)); },
    refresh: () => router.refresh(),
  }));
  const disconnectButton = (
    <Button type="button" variant="ghost" disabled={pending} onClick={onDisconnect}>{tr.text("calendar.google.disconnect")}</Button>
  );

  return (
    <Card id="google-calendar" data-google-card>
      <CardHeader>
        <CardTitle>{tr.text("calendar.google.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {outcome ? (
          <Notice role="status" tone={outcome === "connected" ? "good" : "warn"} className="text-foreground">
            {tr.text(`calendar.google.outcome.${outcome}`)}
          </Notice>
        ) : null}

        {body.kind === "error" ? <p className={muted}>{tr.text("calendar.google.loadError")}</p> : null}

        {body.kind === "empty" ? (
          <>
            <p className={muted}>{tr.text("calendar.google.empty")}</p>
            <ConnectOffer offer={body.connect} label={tr.text("calendar.google.connect")} tr={tr} />
          </>
        ) : null}

        {body.kind === "connected" ? (
          <>
            <DotPill
              label={tr.text("calendar.google.status.connected")}
              chip="border-transparent bg-[var(--good-bg)] text-foreground" dot="bg-[var(--good)]"
            />
            <p className={EMAIL}>{body.email}</p>
            <p className={muted}>{tr.text("calendar.google.connected.note")}</p>
            <p className={muted} suppressHydrationWarning>
              {body.lastCheckedAt
                ? tr.text("calendar.google.lastChecked", { when: formatRelativeTime(body.lastCheckedAt, locale) })
                : tr.text("calendar.google.neverChecked")}
            </p>
            <div className="flex flex-wrap gap-2">{disconnectButton}</div>
          </>
        ) : null}

        {body.kind === "needsReconnect" ? (
          <>
            <DotPill
              label={tr.text("calendar.google.status.needsReconnect")}
              chip="border-transparent bg-[var(--crit-bg)] text-foreground" dot="bg-[var(--crit)]"
            />
            <p className={EMAIL}>{body.email}</p>
            <p className={muted}>{tr.text("calendar.google.needsReconnect.body")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <ConnectOffer offer={body.connect} label={tr.text("calendar.google.reconnect")} tr={tr} />
              {disconnectButton}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The one primary, or the plain words for why there is none (paused, or another address). */
function ConnectOffer({ offer, label, tr }: { offer: GoogleConnectOffer; label: string; tr: Tr }) {
  if (offer.kind === "link") {
    return <Button asChild><a href={offer.href}>{label}</a></Button>;
  }
  return (
    <p className={muted}>
      {offer.kind === "paused" ? tr.text("calendar.google.paused") : tr.text("calendar.google.wrongOrigin", { origin: offer.origin })}
    </p>
  );
}

/** Rule 7: the card while its status streams, shaped like the connected state (a pill, two lines, a button). */
export function GoogleCardSkeleton() {
  return (
    <Card data-google-card-skeleton aria-hidden>
      <CardHeader><Skeleton className="h-5 w-32 rounded-[var(--radius-ctl)]" /></CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-48 rounded-full" />
        <Skeleton className="h-4 w-full rounded-[var(--radius-ctl)]" />
        <Skeleton className="h-4 w-2/3 rounded-[var(--radius-ctl)]" />
        <Skeleton className="h-9 w-28 rounded-[var(--radius-ctl)]" />
      </CardContent>
    </Card>
  );
}
