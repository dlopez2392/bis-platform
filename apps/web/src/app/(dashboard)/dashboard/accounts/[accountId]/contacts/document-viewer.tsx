"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentContentType } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { OFFICE_TYPES, isImageType } from "@/lib/documents/rules";
import type { DocumentView, ScanState } from "@/lib/documents/documents-load";
import { viewerNotice, scanLabel } from "@/lib/documents/scan-state";
import { cn } from "@/lib/utils";
import { getDocumentUrlAction } from "./documents-actions";

/**
 * The viewer (spec 4.3): a dialog over the page (Esc closes, the Dialog's own behaviour). Images and
 * PDFs show inline from a 120-second URL minted when it opens and again on Retry; Word and Excel are
 * never rendered, only downloaded. Every ready version is listed, newest first, each older one offered
 * for download (spec 4.3). A broken image re-mints its URL once on its own, then shows the error state
 * (PR 1a review M7).
 */
export type ViewerState = { status: "loading" } | { status: "error" } | { status: "ready"; url: string; contentType: DocumentContentType };
export type ViewerFetchResult = { key: string; value: Exclude<ViewerState, { status: "loading" }> };

/** The key one mint's answer is filed under: a Retry (an incremented attempt) always gets a fresh key. */
export function fetchKeyFor(versionId: string | null, attempt: number): string | null {
  return versionId ? `${versionId}:${attempt}` : null;
}

/**
 * P3's one gate: a file opens, downloads or is even asked for a URL only once its SHOWN version is
 * clean. Pending, infected, unscannable and locked are all refused the same way (I2) — used by the
 * fetch guard below, the dialog's Download, and rowMenuItems (documents-card.tsx), so none of the
 * three can drift from the other two. Takes the scan state itself (a primitive), not the whole `doc`,
 * so the viewer's effect can depend on it the same way it already depends on `versionId`/`contentType`
 * (review M3: a `doc` re-created with the same fields every render must never retrigger the effect).
 */
export function canOpen(scan: ScanState | null): boolean {
  return scan === "clean";
}

/**
 * Whether the viewer's effect should mint a view URL at all (I2): never for a null/non-clean scan
 * (canOpen), never for an office file (no preview to mint), never without a fetch key. Pure, so "never
 * fetches for a non-clean state" has its own test independent of any effect harness.
 */
export function shouldFetchUrl(scan: ScanState | null, contentType: DocumentContentType | null, fetchKey: string | null): boolean {
  return canOpen(scan) && contentType !== null && !OFFICE_TYPES.includes(contentType) && fetchKey !== null;
}

/**
 * Pure (review I1): loading unless the last-landed result is filed under the CURRENT key. A result from
 * an earlier versionId or an earlier Retry attempt carries an older key and is never shown as the answer
 * to a newer question — it reads as loading until its own answer lands.
 */
export function viewerStateFor(fetchKey: string | null, result: ViewerFetchResult | null): ViewerState {
  return fetchKey !== null && result !== null && result.key === fetchKey ? result.value : { status: "loading" };
}

/**
 * A broken image (PR 1a review M7): the FIRST error for a version re-mints its URL once on its own (a
 * 120-second URL can expire between mint and paint); any later error is the viewer's error state, with
 * the Retry button the person presses. Never an endless loop of mints.
 */
export function imageErrorStep(versionId: string | null, autoRetriedFor: string | null): "retry" | "fail" {
  return versionId !== null && autoRetriedFor !== versionId ? "retry" : "fail";
}

/**
 * Everything the viewer remembers, in ONE value, so every change to it is a pure step with its own test
 * (Task 7 review I1, M1); the component only applies the steps.
 */
export type ViewerSession = { open: boolean; attempt: number; result: ViewerFetchResult | null; autoRetriedFor: string | null };
export const FIRST_SESSION: ViewerSession = { open: false, attempt: 0, result: null, autoRetriedFor: null };

/** The image's onError: the first error for a version records it and re-mints; a later one is the error state for the CURRENT key. */
export function sessionAfterImageError(s: ViewerSession, versionId: string | null): ViewerSession {
  if (imageErrorStep(versionId, s.autoRetriedFor) === "retry") return { ...s, autoRetriedFor: versionId, attempt: s.attempt + 1 };
  const key = fetchKeyFor(versionId, s.attempt);
  return key ? { ...s, result: { key, value: { status: "error" } } } : s;
}

/**
 * Open or closed (review M1): a close bumps the attempt, so reopening the same file mints a fresh
 * 120-second link instead of showing the one cached under the old key, which may have expired. Answers
 * the SAME object when nothing changed, which is what lets the component apply it during render.
 */
export function sessionOnOpenChange(s: ViewerSession, open: boolean): ViewerSession {
  if (s.open === open) return s;
  return open ? { ...s, open: true } : { ...s, open: false, attempt: s.attempt + 1 };
}

export function DocumentViewerBody({ doc, state, locale, onRetry, onImageError }: {
  doc: DocumentView; state: ViewerState; locale: Locale; onRetry: () => void; onImageError: () => void;
}) {
  const tt = (key: MessageKey) => t(m, key, locale);
  // S-07 2a (spec 3.3): a file not scanned clean is never shown, whatever a stale state says.
  const notice = viewerNotice(doc);
  if (notice) return <p data-viewer-notice className="text-sm text-muted-foreground">{tt(notice)}</p>;
  if (OFFICE_TYPES.includes(doc.version.contentType)) {
    return <p className="text-sm text-muted-foreground">{tt("documents.viewer.noPreview")}</p>;
  }
  if (state.status === "loading") return <Skeleton data-viewer-skeleton className="h-[60vh] w-full rounded-[var(--radius-ctl)]" />;
  if (state.status === "error") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{tt("documents.error.open")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>{tt("documents.retry")}</Button>
      </div>
    );
  }
  if (isImageType(state.contentType)) {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived private URL; next/image would cache it.
    return <img src={state.url} alt={doc.title} className="mx-auto max-h-[70vh] w-auto rounded-[var(--radius-ctl)]" onError={onImageError} />;
  }
  return <iframe src={state.url} title={doc.title} className="h-[70vh] w-full rounded-[var(--radius-ctl)] border border-[var(--line)]" />;
}

/** A version that cannot be downloaded says why: a dot AND the word (rule 3). */
function VersionScan({ scan, locale }: { scan: DocumentView["versions"][number]["scan"]; locale: Locale }) {
  const label = scanLabel(scan, locale);
  if (!label) return null;
  return (
    <span data-version-scan={scan} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", label.tone === "crit" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} />
      {label.text}
    </span>
  );
}

/**
 * The Versions list (spec 4.3): every ready version, newest first, numbered by upload order (the newest
 * the highest); the current one says "Current" and has no Download of its own (the dialog's Download is
 * it); each older one has a ghost Download. Drawn only when there is more than one version.
 */
export function DocumentVersionsList({ doc, locale, when, onDownload }: {
  doc: DocumentView; locale: Locale; when: (addedOn: string) => string; onDownload: (versionId: string) => void;
}) {
  if (doc.versions.length < 2) return null;
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const total = doc.versions.length;
  return (
    <section data-document-versions aria-label={tt("documents.versions")}>
      <h3 className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt("documents.versions")}</h3>
      <ul>
        {doc.versions.map((v, i) => {
          const n = total - i;
          return (
            <li key={v.id} data-document-version-row={v.id}
              className="flex items-center justify-between gap-2 border-t border-[var(--row-line)] py-1.5 text-sm first:border-t-0">
              <span className="tabular-nums">{tt("documents.versionLine", { n, when: when(v.addedOn) })}</span>
              {v.id === doc.version.id && v.scan === "clean" ? (
                <span className="text-xs text-muted-foreground">{tt("documents.versionCurrent")}</span>
              ) : v.scan === "clean" ? (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                  aria-label={tt("documents.downloadVersion", { n })} onClick={() => onDownload(v.id)}>{tt("documents.download")}</Button>
              ) : (
                <VersionScan scan={v.scan} locale={locale} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The dialog's own Download (spec 4.3; I2): drawn only for a clean file, through the same `canOpen` gate
 * as the effect's fetch guard and rowMenuItems (documents-card.tsx) — absent entirely for anything the
 * server would refuse anyway, never a disabled button. Its own component (outside `DialogContent`, which
 * needs a real DOM portal) so "draws no Download for each non-clean state" has a test this suite's
 * node-only harness can actually run.
 */
export function DocumentViewerDownload({ doc, locale, onDownload }: { doc: DocumentView; locale: Locale; onDownload: () => void }) {
  if (!canOpen(doc.version.scan)) return null;
  return (
    <div className="flex justify-end">
      <Button type="button" className="min-h-11 md:min-h-8" onClick={onDownload}>{t(m, "documents.download", locale)}</Button>
    </div>
  );
}

/** S-07 3b (spec 4.1): the viewer's Copy share link, ghost (the dialog's one primary stays Download); only for a clean, live file. */
export function DocumentViewerShare({ doc, locale, onShare }: { doc: DocumentView; locale: Locale; onShare?: (doc: DocumentView) => void }) {
  if (!onShare || !canOpen(doc.version.scan) || doc.deletedAt !== null) return null;
  return (
    <Button type="button" variant="ghost" size="sm" data-document-share className="min-h-11 self-start md:min-h-8" onClick={() => onShare(doc)}>
      <Link2 aria-hidden="true" />{t(m, "documents.share", locale)}
    </Button>
  );
}

export function DocumentViewer({ accountId, doc, header, locale, onClose, onDownload, versionWhen, onDownloadVersion, onShare }: {
  accountId: string; doc: DocumentView | null; header: { source: string; expiry: string | null }; locale: Locale;
  onClose: () => void; onDownload: (doc: DocumentView) => void;
  versionWhen: (addedOn: string) => string; onDownloadVersion: (doc: DocumentView, versionId: string) => void;
  onShare?: (doc: DocumentView) => void;
}) {
  // Loading is DERIVED, never set synchronously in the effect (react-hooks/set-state-in-effect):
  // `result` only ever updates from the promise's own callback, as slot-picker.tsx's `getSlots`
  // effect does. `attempt` gives Retry a fresh key without a synchronous setState of its own.
  // `viewerStateFor`/`fetchKeyFor` are pure and exported so the decision has its own tests (review I1):
  // a stale result for an older key (an earlier versionId, or a Retry's earlier attempt) is loading,
  // never the stale value. Every change to the session is one of the pure steps above (review I1, M1).
  const [stored, setSession] = useState<ViewerSession>(FIRST_SESSION);
  // M1: a close is noticed DURING RENDER (React's "adjusting state when a prop changes"), never in an
  // effect, and whichever way the viewer closed: its own close, or the file leaving the card's list.
  const session = sessionOnOpenChange(stored, doc !== null);
  if (session !== stored) setSession(session);
  const { attempt, result } = session;
  const versionId = doc?.version.id ?? null;
  // The effect depends on these PRIMITIVES, not `doc` itself (review M3): a `doc` re-created with the
  // same fields on every render would otherwise re-run the effect, and re-mint a URL, on every render.
  const contentType = doc?.version.contentType ?? null;
  const scan = doc?.version.scan ?? null;
  const fetchKey = fetchKeyFor(versionId, attempt);
  useEffect(() => {
    // I2: the whole guard is one pure predicate (shouldFetchUrl), so "never fetches for a non-clean
    // state" is provable without a DOM/effect harness this suite has no jsdom to run.
    if (!versionId || !fetchKey || !shouldFetchUrl(scan, contentType, fetchKey)) return;
    let cancelled = false;
    void getDocumentUrlAction(accountId, versionId, "view")
      .then((r) => {
        if (!cancelled) setSession((s) => ({ ...s, result: { key: fetchKey, value: r.ok ? { status: "ready", url: r.url, contentType: r.contentType } : { status: "error" } } }));
      })
      .catch(() => { if (!cancelled) setSession((s) => ({ ...s, result: { key: fetchKey, value: { status: "error" } } })); });
    return () => { cancelled = true; };
  }, [accountId, versionId, contentType, scan, fetchKey]);
  const state: ViewerState = viewerStateFor(fetchKey, result);
  const mint = useCallback(() => setSession((s) => ({ ...s, attempt: s.attempt + 1 })), []);
  // M7: the image's onError applies the pure step (an event handler, never an effect).
  const onImageError = () => setSession((s) => sessionAfterImageError(s, versionId));
  const tt = (key: MessageKey) => t(m, key, locale);
  return (
    <Dialog open={doc !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl" data-document-viewer>
        {doc ? (
          <>
            <DialogHeader>
              <DialogTitle lang="">{doc.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
                <span aria-hidden="true">·</span>
                <span>{header.source}</span>
                {header.expiry ? <><span aria-hidden="true">·</span><span>{header.expiry}</span></> : null}
                {doc.ownersOnly ? (
                  <span className="inline-flex items-center gap-1"><Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}</span>
                ) : null}
              </DialogDescription>
              <DocumentViewerShare doc={doc} locale={locale} onShare={onShare} />
            </DialogHeader>
            <DocumentViewerBody doc={doc} state={state} locale={locale} onRetry={mint} onImageError={onImageError} />
            <DocumentVersionsList doc={doc} locale={locale} when={versionWhen} onDownload={(id) => onDownloadVersion(doc, id)} />
            <DocumentViewerDownload doc={doc} locale={locale} onDownload={() => onDownload(doc)} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
