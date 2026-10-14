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
 * never rendered, only downloaded. Versions arrive with PR 1b.
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

export function DocumentViewerBody({ doc, state, locale, onRetry }: { doc: DocumentView; state: ViewerState; locale: Locale; onRetry: () => void }) {
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
    return <img src={state.url} alt={doc.title} className="mx-auto max-h-[70vh] w-auto rounded-[var(--radius-ctl)]" onError={onRetry} />;
  }
  return <iframe src={state.url} title={doc.title} className="h-[70vh] w-full rounded-[var(--radius-ctl)] border border-[var(--line)]" />;
}

export function DocumentViewer({ accountId, doc, header, locale, onClose, onDownload }: {
  accountId: string; doc: DocumentView | null; header: { source: string; expiry: string | null }; locale: Locale;
  onClose: () => void; onDownload: (doc: DocumentView) => void;
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
            <DocumentViewerBody doc={doc} state={state} locale={locale} onRetry={mint} />
            <div className="flex justify-end">
              <Button type="button" className="min-h-11 md:min-h-8" onClick={() => onDownload(doc)}>{tt("documents.download")}</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
