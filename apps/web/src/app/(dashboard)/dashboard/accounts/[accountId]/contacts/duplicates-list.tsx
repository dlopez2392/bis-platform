"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * F-006 part 1 (plan Task 10, Step 5): the Possible duplicates view's rows. The whole row is the click
 * target (DESIGN.md rule 4; a row is not a link), opening the compare screen; "Not the same person" is a
 * ghost action that runs at once, with Undo (rule 6). No checkbox: this list has no bulk bar.
 */

export type DuplicateRow = {
  id: string; href: string; aName: string; bName: string; reasonText: string; foundOnText: string;
};

type DismissResult = { ok: true } | { ok: false; errorKey: MessageKey };
type DismissFn = (flagId: string) => Promise<DismissResult>;

/** The button's own click must never also open the row it sits on (rule 4's whole-row target would
 *  otherwise fire too) — the one place that decision lives, so dropping it is a one-line mutation. */
export function stopRowNav(e: { stopPropagation: () => void }, run: () => void): void {
  e.stopPropagation();
  run();
}

async function undoDismiss(undismiss: DismissFn, flagId: string, locale: Locale, onUndone: () => void): Promise<void> {
  try {
    const r = await undismiss(flagId);
    if (!r.ok) { toast.error(t(m, r.errorKey, locale)); return; }
    onUndone();
  } catch {
    toast.error(t(m, "contacts.duplicates.dismissFailed", locale));
  }
}

/** Runs at once: a refusal or a throw changes nothing and says so; a success hides the row and offers
 *  Undo, which puts it back through `undismiss`. Exported so this is testable without a DOM
 *  (archive-controls.ts's own pattern). */
export async function dismissOne(
  dismiss: DismissFn, undismiss: DismissFn, flagId: string, locale: Locale, onDone: () => void, onUndone: () => void,
): Promise<void> {
  try {
    const r = await dismiss(flagId);
    if (!r.ok) { toast.error(t(m, r.errorKey, locale)); return; }
    onDone();
    toast.success(t(m, "contacts.duplicates.dismissed", locale), {
      action: { label: t(m, "common.undo", locale), onClick: () => void undoDismiss(undismiss, flagId, locale, onUndone) },
    });
  } catch {
    toast.error(t(m, "contacts.duplicates.dismissFailed", locale));
  }
}

export function DuplicatesList({
  rows, locale, dismissAction, undismissAction,
}: {
  rows: DuplicateRow[]; locale: Locale; dismissAction: DismissFn; undismissAction: DismissFn;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const visible = rows.filter((row) => !hidden.has(row.id));
  const open = (href: string) => router.push(href);

  return (
    <div data-duplicates-list role="list" className="divide-y divide-[var(--line)]">
      {visible.map((row) => (
        <div
          key={row.id}
          data-duplicate-row={row.id}
          role="listitem"
          tabIndex={0}
          aria-label={`${row.aName} ${row.bName}`}
          onClick={() => open(row.href)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(row.href); }
          }}
          className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 outline-none hover:bg-[var(--surface-3)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text-1)]">{row.aName} · {row.bName}</p>
            <p className="truncate text-xs text-[var(--text-2)]">{row.reasonText} · {row.foundOnText}</p>
          </div>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            onClick={(e) => stopRowNav(e, () => {
              void dismissOne(
                dismissAction, undismissAction, row.id, locale,
                () => setHidden((prev) => new Set(prev).add(row.id)),
                () => setHidden((prev) => { const next = new Set(prev); next.delete(row.id); return next; }),
              );
            })}
          >
            {t(m, "contacts.duplicates.notSame", locale)}
          </button>
        </div>
      ))}
    </div>
  );
}
