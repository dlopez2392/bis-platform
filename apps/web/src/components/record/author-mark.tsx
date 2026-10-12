import type { AuthorKind } from "@bis/db";

// Re-exported for timeline-item.tsx, which imports it from here.
export type { AuthorKind };

/**
 * Who made a timeline row (spec §6; DESIGN.md, Provenance): one of five kinds, always said in a
 * word, never colour alone. AiAuthorMark's chip (calls/ai-author-mark.tsx) generalised: the chip
 * tokens, a 999px pill, the Label size. A long name truncates with its full text in `title`.
 */
export function AuthorMark({ kind, label }: { kind: AuthorKind; label: string }) {
  return (
    <span data-author-mark={kind} title={label}
      className="inline-flex max-w-[14rem] shrink-0 items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 text-[10px] leading-4 font-medium text-[var(--chip-text)]">
      <span className="truncate">{label}</span>
    </span>
  );
}
