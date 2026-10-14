"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentContentType } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { OFFICE_TYPES, isImageType } from "@/lib/documents/rules";
import type { DocumentView } from "@/lib/documents/documents-load";
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

export function DocumentViewerBody({ doc, state, locale, onRetry, onImageError }: {
  doc: DocumentView; state: ViewerState; locale: Locale; onRetry: () => void; onImageError: () => void;
}) {
  const tt = (key: MessageKey) => t(m, key, locale);
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
              {v.id === doc.version.id ? (
                <span className="text-xs text-muted-foreground">{tt("documents.versionCurrent")}</span>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                  aria-label={tt("documents.downloadVersion", { n })} onClick={() => onDownload(v.id)}>{tt("documents.download")}</Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DocumentViewer({ accountId, doc, header, locale, onClose, onDownload, versionWhen, onDownloadVersion }: {
  accountId: string; doc: DocumentView | null; header: { source: string; expiry: string | null }; locale: Locale;
  onClose: () => void; onDownload: (doc: DocumentView) => void;
  versionWhen: (addedOn: string) => string; onDownloadVersion: (doc: DocumentView, versionId: string) => void;
}) {
  // Loading is DERIVED, never set synchronously in the effect (react-hooks/set-state-in-effect):
  // `result` only ever updates from the promise's own callback, as slot-picker.tsx's `getSlots`
  // effect does. `attempt` gives Retry a fresh key without a synchronous setState of its own.
  // `viewerStateFor`/`fetchKeyFor` are pure and exported so the decision has its own tests (review I1):
  // a stale result for an older key (an earlier versionId, or a Retry's earlier attempt) is loading,
  // never the stale value.
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ViewerFetchResult | null>(null);
  const versionId = doc?.version.id ?? null;
  // The effect depends on these PRIMITIVES, not `doc` itself (review M3): a `doc` re-created with the
  // same fields on every render would otherwise re-run the effect, and re-mint a URL, on every render.
  const contentType = doc?.version.contentType ?? null;
  const fetchKey = fetchKeyFor(versionId, attempt);
  useEffect(() => {
    if (!versionId || !contentType || OFFICE_TYPES.includes(contentType) || !fetchKey) return;
    let cancelled = false;
    void getDocumentUrlAction(accountId, versionId, "view")
      .then((r) => { if (!cancelled) setResult({ key: fetchKey, value: r.ok ? { status: "ready", url: r.url, contentType: r.contentType } : { status: "error" } }); })
      .catch(() => { if (!cancelled) setResult({ key: fetchKey, value: { status: "error" } }); });
    return () => { cancelled = true; };
  }, [accountId, versionId, contentType, fetchKey]);
  const state: ViewerState = viewerStateFor(fetchKey, result);
  const mint = useCallback(() => setAttempt((a) => a + 1), []);
  // M7: the version whose ONE automatic retry has been spent. Set in an event handler (the image's
  // onError), never in an effect.
  const [autoRetriedFor, setAutoRetriedFor] = useState<string | null>(null);
  const onImageError = () => {
    if (imageErrorStep(versionId, autoRetriedFor) === "retry") {
      setAutoRetriedFor(versionId);
      mint();
    } else if (fetchKey) {
      setResult({ key: fetchKey, value: { status: "error" } });
    }
  };
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
            </DialogHeader>
            <DocumentViewerBody doc={doc} state={state} locale={locale} onRetry={mint} onImageError={onImageError} />
            <DocumentVersionsList doc={doc} locale={locale} when={versionWhen} onDownload={(id) => onDownloadVersion(doc, id)} />
            <div className="flex justify-end">
              <Button type="button" className="min-h-11 md:min-h-8" onClick={() => onDownload(doc)}>{tt("documents.download")}</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
