"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { usePhone } from "./use-phone";
import { RecordCardBoundary } from "./record-card-boundary";

export type RecordCardState = "loading" | "ready" | "empty" | "error";

/** Rule 7: rows shaped like the content, never a spinner. */
export function RecordCardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" data-record-skeleton aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-4 rounded-[var(--radius-ctl)]", i % 2 === 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** "Try again": re-reads the server page unless the caller retries something narrower. */
export function RecordCardRetry({ label, onRetry }: { label: string; onRetry?: () => void }) {
  const router = useRouter();
  return (
    <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-8" onClick={onRetry ?? (() => router.refresh())}>
      {label}
    </Button>
  );
}

export function RecordCardError({ text, retryLabel, onRetry }: { text: string; retryLabel: string; onRetry?: () => void }) {
  return (
    // role="alert": this repo's error role; "status" is for success and info (public-form.tsx).
    <div role="alert" className="space-y-2 text-sm" data-record-error>
      <p className="text-muted-foreground">{text}</p>
      <RecordCardRetry label={retryLabel} onRetry={onRetry} />
    </div>
  );
}

export type RecordCardViewProps = {
  id: string; title: string; state: RecordCardState; skeletonRows: number; errorText: string;
  retryLabel: string; showLabel: string;
  /** A phone disclosure (collapsible card on a phone); `open` is its state. */
  disclosure: boolean; open: boolean; onToggle: () => void;
  onRetry?: () => void; action?: ReactNode; children?: ReactNode;
  /** Drawn in place of RecordCardSkeleton while loading (the timeline loads as rows, not lines). */
  skeleton?: ReactNode;
};

/**
 * The one card chrome (spec §8): glass, a title in UI 600 at 13.5px, rows split by --row-line
 * rules inside, never a box in a glass card. A closed disclosure mounts NO body.
 */
export function RecordCardView(p: RecordCardViewProps) {
  const titleId = useId();
  const bodyId = useId();
  const closed = p.disclosure && !p.open;
  return (
    <section data-record-card={p.id} data-state={p.state} aria-labelledby={titleId}
      className="min-w-0 rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="min-w-0 flex-1 text-[13.5px] font-semibold text-card-foreground">
          {p.disclosure ? (
            // aria-controls only while the body is mounted: a closed card renders no body, and a
            // link to nothing is worse than none (setup-rail.tsx's SETUP_PANE_ID note).
            <button type="button" aria-expanded={p.open} aria-controls={closed ? undefined : bodyId}
              aria-label={closed ? p.showLabel : undefined} onClick={p.onToggle}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-ctl)] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <span className="truncate" title={p.title}>{p.title}</span>
              <ChevronDown aria-hidden className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                p.open && "rotate-180")} />
            </button>
          ) : (
            <span className="block truncate" title={p.title}>{p.title}</span>
          )}
        </h2>
        {!closed && p.action ? p.action : null}
      </div>
      {closed ? null : (
        <div id={bodyId} className="mt-2">
          {p.state === "loading" ? (
            p.skeleton ?? <RecordCardSkeleton rows={p.skeletonRows} />
          ) : p.state === "error" ? (
            <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={p.onRetry} />
          ) : (
            <RecordCardBoundary
              skeleton={p.skeleton ?? <RecordCardSkeleton rows={p.skeletonRows} />}
              fallback={(reset) => <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={reset} />}
            >
              {p.children}
            </RecordCardBoundary>
          )}
        </div>
      )}
    </section>
  );
}

export type RecordCardProps = {
  id: string; title: string; collapsibleOnPhone?: boolean; state?: RecordCardState; skeletonRows?: number;
  errorText?: string; onRetry?: () => void; action?: ReactNode; children?: ReactNode;
  /** Drawn in place of the default line skeleton while loading. */
  skeleton?: ReactNode;
};

/** A record card: the chrome, its own boundary, and (when `collapsibleOnPhone`) a phone disclosure. */
export function RecordCard({ id, title, collapsibleOnPhone = false, state = "ready", skeletonRows = 3,
  errorText, onRetry, action, skeleton, children }: RecordCardProps) {
  const locale = useLocale();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  return (
    <RecordCardView id={id} title={title} state={state} skeletonRows={skeletonRows}
      errorText={errorText ?? t(m, "record.card.failed", locale, { title })}
      retryLabel={t(m, "record.card.retry", locale)} showLabel={t(m, "record.card.show", locale, { title })}
      disclosure={collapsibleOnPhone && phone} open={open} onToggle={() => setOpen((o) => !o)}
      onRetry={onRetry} action={action} skeleton={skeleton}>
      {children}
    </RecordCardView>
  );
}
