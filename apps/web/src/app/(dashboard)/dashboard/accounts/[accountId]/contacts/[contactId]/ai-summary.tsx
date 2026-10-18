"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RecordCardSkeleton } from "@/components/record/record-card";
import { RecordCardBoundaryCore } from "@/components/record/record-card-boundary";
import type { AiSummaryResponse } from "@/lib/record/ai-summary-view";
import { loadAiSummary } from "./ai-summary-handlers";

/** The page translates every label (its tr: the pseudo-locale reaches them); this file has no copy of its own. */
export type AiSummaryLabels = { regenerate: string; retry: string; failed: string; capped: string; writing: string };
type View = { state: "loading" } | AiSummaryResponse;
const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const CONTROL = "min-h-11 md:min-h-8";

/** Item 8a-2 (spec 4.8): the five states under the facts line. "none" draws nothing (I13). */
export function AiSummaryView({ view, labels, onRegenerate, onRetry }: {
  view: View; labels: AiSummaryLabels; onRegenerate: () => void; onRetry: () => void;
}) {
  switch (view.state) {
    case "loading":
    case "generating":
      return (
        <div data-ai-summary data-state="loading" aria-busy="true" className="space-y-1">
          <span role="status" className="sr-only">{labels.writing}</span>
          <RecordCardSkeleton rows={2} />
        </div>
      );
    case "none":
      return null;
    case "capped":
      return <p data-ai-summary data-state="capped" className="text-sm text-muted-foreground">{labels.capped}</p>;
    case "failed":
      return (
        <div data-ai-summary data-state="failed" role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{labels.failed}</span>
          <Button type="button" size="sm" variant="ghost" className={CONTROL} data-ai-retry onClick={onRetry}>{labels.retry}</Button>
        </div>
      );
    case "ready":
      return (
        <div data-ai-summary data-state="ready" className="space-y-1">
          <p data-ai-summary-text lang={view.language} className="text-sm text-card-foreground [overflow-wrap:anywhere]">{view.text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span data-ai-summary-label data-generated-at={view.generatedAt} className={`${LABEL} tabular-nums`}>{view.stamp}</span>
            <Button type="button" size="sm" variant="ghost" className={CONTROL} data-ai-regenerate onClick={onRegenerate}>{labels.regenerate}</Button>
          </div>
        </div>
      );
  }
}

/**
 * Fetches after the page (spec 4.1), in its own boundary: its fault never takes the facts line
 * (rule 5, the card). `view` is DERIVED from comparing the read it last settled against the read
 * it is currently asking for (the same `state.route === route` shape `documents-card.tsx` uses),
 * never set synchronously inside the effect body itself (react-hooks/set-state-in-effect) — only
 * the effect's own fetch callback calls `setState`.
 */
export function AiSummary({ url, labels }: { url: string; labels: AiSummaryLabels }) {
  const [trigger, setTrigger] = useState<{ nonce: number; force: boolean }>({ nonce: 0, force: false });
  const [settled, setSettled] = useState<{ key: string; view: AiSummaryResponse } | null>(null);
  const key = `${url}:${trigger.nonce}`;
  const view: View = settled?.key === key ? settled.view : { state: "loading" };
  const run = (force: boolean) => setTrigger((t) => ({ nonce: t.nonce + 1, force }));
  useEffect(() => {
    const ac = new AbortController();
    void loadAiSummary(url, { force: trigger.force, signal: ac.signal }).then((r) => {
      if (!ac.signal.aborted) setSettled({ key, view: r });
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already folds `url` and `trigger.nonce` together; `trigger.force` travels with the same setTrigger call that bumped `nonce`, so it is never stale when this fires.
  }, [key]);
  return (
    <div data-ai-summary-url={url}>
      <RecordCardBoundaryCore
        fallback={(reset) => <AiSummaryView view={{ state: "failed" }} labels={labels} onRegenerate={() => {}} onRetry={reset} />}
        onReset={() => run(false)}>
        <AiSummaryView view={view} labels={labels} onRegenerate={() => run(true)} onRetry={() => run(false)} />
      </RecordCardBoundaryCore>
    </div>
  );
}
