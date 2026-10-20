import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import Link from "next/link";
import { TimelineItem, type TimelineItemProps } from "@/components/record/timeline-item";
import type { AiActView } from "@/lib/ai-acts/view";
import type { Locale } from "@/lib/i18n/locale";
import { ActUndo } from "./act-undo";

/**
 * One act's timeline row (item 8c, plan Task 6): the same flat `TimelineItem` every row sits on, the AI
 * mark, the sentence (`verb`/`detail`, Task 5's `describeAct`), the source line (a ghost text link to the
 * call, or plain text for a web-chat act with no page of its own), and on the right, by `act.undo.state`:
 *   - "available" → the control (field / booking / contact), from `ActUndo`;
 *   - "blocked" / "undone" → the reason or the stamp, as muted text — no control, nothing to press;
 *   - "unknown" → nothing (the facts read failed; the row still shows, same as DESIGN.md rule 5's card).
 * No glass card, and NO primary button on the row itself (DESIGN.md rule 8, the 2026-10-19 amendment): the
 * popover and the dialog are each their own view, and carry their own one primary (`act-undo.tsx`).
 * Server-safe: it never calls a function exported from a `"use client"` module (8b-2 final review I-1) —
 * `ActUndo` is handed as a CHILD element here, which is fine; it is never invoked.
 */
export function ActRow({
  head, act, accountId, locale,
}: {
  head: Pick<TimelineItemProps, "kind" | "mark" | "verb" | "status" | "detail" | "time" | "dateTime">;
  act: AiActView; accountId: string; locale: Locale;
}) {
  const action: ReactNode = act.undo.state === "available"
    ? <ActUndo accountId={accountId} act={act} locale={locale} />
    : act.undo.state === "blocked" || act.undo.state === "undone"
      ? <span data-ai-act-line="" className="text-xs text-muted-foreground">{act.undo.line}</span>
      : null;
  return (
    <div lang={locale} data-ai-act-row="">
      <TimelineItem {...head} icon={Bot} action={action}>
        {act.source.href ? (
          <Link href={act.source.href} data-ai-act-source=""
            className="rounded-[var(--radius-ctl)] text-xs text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {act.source.label}
          </Link>
        ) : (
          <span data-ai-act-source="" className="text-xs text-muted-foreground">{act.source.label}</span>
        )}
      </TimelineItem>
    </div>
  );
}
