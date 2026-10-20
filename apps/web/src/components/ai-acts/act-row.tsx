import { Bot } from "lucide-react";
import Link from "next/link";
import { TimelineItem, type TimelineItemProps } from "@/components/record/timeline-item";
import type { AiActView } from "@/lib/ai-acts/view";
import type { Locale } from "@/lib/i18n/locale";
import { ActUndo, type ActUndoRun } from "./act-undo";

/**
 * One act's timeline row (item 8c, plan Task 6): the same flat `TimelineItem` every row sits on, the AI
 * mark, the sentence (`verb`/`detail`, Task 5's `describeAct`), then under it one muted line: the source (a
 * ghost text link to the call, or plain text for a web-chat act with no page of its own) and, by
 * `act.undo.state`:
 *   - "available" → nothing more on the line; the control (field / booking / contact, from `ActUndo`) is
 *     the row's action, on the right, described by the row's sentence (design M-5);
 *   - "blocked" / "undone" → the reason or the stamp, after the source ("From the call on Oct 15 · Undone
 *     by You · Oct 19"), never in the action slot, where at 360 px it squeezed the sentence (design I-3).
 *     It is `tabIndex -1`, so focus can land on it after an Undo (design M-1);
 *   - "unknown" → nothing (the facts read failed; the row still shows, same as DESIGN.md rule 5's card).
 * The row names its act and state (`data-ai-act-id`, `data-ai-act-state`): the focus move finds the line by
 * them, and a test finds a row in any language.
 * No glass card, and NO primary button on the row itself (DESIGN.md rule 8, the 2026-10-19 amendment): the
 * popover and the dialog are each their own view, and carry their own one primary (`act-undo.tsx`).
 * Server-safe: it never calls a function exported from a `"use client"` module (8b-2 final review I-1) —
 * `ActUndo` is handed as a CHILD element here, which is fine; it is never invoked. `run` is for the
 * styleguide only (inert actions); the record page never passes it.
 */
export function ActRow({
  head, act, accountId, locale, run,
}: {
  head: Pick<TimelineItemProps, "kind" | "mark" | "verb" | "status" | "detail" | "time" | "dateTime">;
  act: AiActView; accountId: string; locale: Locale; run?: ActUndoRun;
}) {
  const sentenceId = `ai-act-${act.id}`;
  const line = act.undo.state === "blocked" || act.undo.state === "undone" ? act.undo.line : null;
  return (
    <div lang={locale} data-ai-act-row="" data-ai-act-id={act.id} data-ai-act-state={act.undo.state}>
      <TimelineItem {...head} icon={Bot} textId={sentenceId}
        action={act.undo.state === "available"
          ? <ActUndo accountId={accountId} act={act} locale={locale} describedBy={sentenceId} run={run} />
          : null}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {act.source.href ? (
            <Link href={act.source.href} data-ai-act-source=""
              className="inline-flex min-h-11 items-center rounded-[var(--radius-ctl)] underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
              {act.source.label}
            </Link>
          ) : (
            <span data-ai-act-source="">{act.source.label}</span>
          )}
          {line ? (
            <>
              <span aria-hidden="true">·</span>
              <span data-ai-act-line="" tabIndex={-1}
                className="min-w-0 break-words rounded-[var(--radius-ctl)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {line}
              </span>
            </>
          ) : null}
        </div>
      </TimelineItem>
    </div>
  );
}
