"use client";

import { useId, type ReactNode } from "react";
import { RecordCardError, RecordCardSkeleton, type RecordCardState } from "./record-card";
import { RecordCardBoundary } from "./record-card-boundary";

export type RecordSectionProps = {
  id: string;
  /** The mono label (DESIGN.md's Label role); null for a section that continues the header. */
  label: string | null;
  state: RecordCardState;
  errorText: string;
  retryLabel: string;
  /** Required: a section lives inside an overlay, where router.refresh() would re-read the page behind it. */
  onRetry: () => void;
  skeletonRows?: number;
  /** Drawn in place of the line skeleton while loading (Recent loads as rows). */
  skeleton?: ReactNode;
  children?: ReactNode;
};

/**
 * The card chrome's flat twin (S-03 part 3 C4) for a surface that is already glass (the Sheet): a
 * mono label, a `--line` rule above every section but the first, rows the caller rules with
 * `--row-line`, and the SAME skeleton, error and boundary as a card. Never a glass box in the glass.
 */
export function RecordSection(p: RecordSectionProps) {
  const labelId = useId();
  const skeleton = p.skeleton ?? <RecordCardSkeleton rows={p.skeletonRows ?? 3} />;
  return (
    <section data-record-section={p.id} data-state={p.state} aria-labelledby={p.label ? labelId : undefined}
      className="min-w-0 border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0">
      {p.label ? (
        <h3 id={labelId} className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{p.label}</h3>
      ) : null}
      {p.state === "loading" ? skeleton
        : p.state === "error" ? <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={p.onRetry} />
        : (
          <RecordCardBoundary onReset={p.onRetry} skeleton={skeleton}
            fallback={(reset) => <RecordCardError text={p.errorText} retryLabel={p.retryLabel} onRetry={reset} />}>
            {p.children}
          </RecordCardBoundary>
        )}
    </section>
  );
}
