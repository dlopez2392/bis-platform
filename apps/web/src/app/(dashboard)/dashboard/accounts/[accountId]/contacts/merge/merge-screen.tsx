"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { t } from "@/lib/i18n/t";
import { m as messages, type MessageKey } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MergeChoice } from "@bis/db";
import type { MergeActionResult } from "../merge-actions";
import type { UndoMergeActionResult } from "../merge-actions";

/**
 * F-006 part 1 (plan Task 10, Step 4): the compare screen. Two columns on a desk, the kept record
 * first; each conflicting field a radio pair; one primary button, Merge (DESIGN.md rule 8). The
 * choices sent are built ONLY from the fields actually in conflict — never the full MERGE_CHOICE_FIELDS
 * list — so a field both records already agree on is never silently re-decided.
 */

export type Conflict = { field: string; keepValue: unknown; otherValue: unknown; preselect: MergeChoice };

const FIELD_KEY: Readonly<Record<string, MessageKey>> = {
  first_name: "contacts.merge.field.firstName",
  last_name: "contacts.merge.field.lastName",
  email: "contacts.merge.field.email",
  phone: "contacts.merge.field.phone",
  assigned_to: "contacts.merge.field.assignedTo",
  language: "contacts.merge.field.language",
};

function fieldLabel(field: string, locale: Locale): string {
  if (field.startsWith("custom.")) return t(messages, "contacts.merge.field.custom", locale, { label: field.slice("custom.".length) });
  return t(messages, FIELD_KEY[field] ?? "contacts.merge.field.custom", locale, { label: field });
}

function displayValue(v: unknown): string {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

/** What the Merge button actually sends: one choice per conflict ON SCREEN, nothing more. */
export function choicesFromConflicts(conflicts: readonly Conflict[], selected: Readonly<Record<string, MergeChoice>>): Record<string, MergeChoice> {
  return Object.fromEntries(conflicts.map((c) => [c.field, selected[c.field] ?? c.preselect]));
}

type MergeInput = { keepId: string; otherId: string; choices: Record<string, MergeChoice>; seen: { keep: string; other: string } };
type MergeAction = (input: MergeInput) => Promise<MergeActionResult>;
type UndoAction = (mergeId: number) => Promise<UndoMergeActionResult>;

async function runUndo(undoAction: UndoAction, mergeId: number, locale: Locale, otherName: string, onUndone: () => void): Promise<void> {
  const r = await undoAction(mergeId);
  if (!r.ok) { toast.error(t(messages, r.errorKey, locale)); return; }
  toast.success(t(messages, "contacts.merge.undone", locale, { name: otherName }));
  onUndone();
}

/** Runs the merge, then wires the toast's own Undo to the MERGE ID THE ACTION RETURNED — never the
 *  pair's own ids, which would ask to undo the wrong thing once more than one merge has touched either
 *  record. */
export async function runMerge(
  mergeAction: MergeAction, undoAction: UndoAction, input: MergeInput, locale: Locale,
  ctx: { keepName: string; onMerged: () => void; onStale: () => void; onUndone?: () => void },
): Promise<void> {
  const r = await mergeAction(input);
  if (!r.ok) {
    toast.error(t(messages, r.errorKey, locale));
    if (r.errorKey === "contacts.merge.stale") ctx.onStale();
    return;
  }
  ctx.onMerged();
  toast.success(t(messages, "contacts.merge.done", locale, { name: ctx.keepName }), {
    action: {
      label: t(messages, "common.undo", locale),
      onClick: () => void runUndo(undoAction, r.mergeId, locale, ctx.keepName, ctx.onUndone ?? (() => {})),
    },
  });
}

export function MergeScreen({
  accountId, keep, other, conflicts, alsoKeeps, otherReach, movesText, seen, swapHref, locale, mergeAction, undoAction,
}: {
  accountId: string;
  keep: { id: string; name: string };
  other: { id: string; name: string };
  conflicts: Conflict[];
  alsoKeeps: string[];
  otherReach: { phone?: string; email?: string };
  movesText: string;
  seen: { keep: string; other: string };
  swapHref: string;
  locale: Locale;
  mergeAction: MergeAction;
  undoAction: UndoAction;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, MergeChoice>>({});
  const [busy, setBusy] = useState(false);
  const recordHref = `/dashboard/accounts/${accountId}/contacts/${keep.id}`;
  const contactsHref = `/dashboard/accounts/${accountId}/contacts`;

  const onMerge = () => {
    setBusy(true);
    void runMerge(
      mergeAction, undoAction,
      { keepId: keep.id, otherId: other.id, choices: choicesFromConflicts(conflicts, selected), seen },
      locale,
      {
        keepName: keep.name,
        onMerged: () => router.push(recordHref),
        onStale: () => { setBusy(false); router.refresh(); },
      },
    ).then(() => setBusy(false));
  };

  return (
    <div className="p-6" lang={locale}>
      <h1 className="mb-1 text-[22px] font-semibold tracking-[-.02em] text-[var(--text-1)]">
        {t(messages, "contacts.merge.title", locale)}
      </h1>
      <Link href={swapHref} className={cn(buttonVariants({ variant: "link", size: "sm" }), "px-0")}>
        {t(messages, "contacts.merge.swap", locale)}
      </Link>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {[keep, other].map((person, i) => (
          <div key={person.id} className="space-y-2 rounded-xl border border-border p-4">
            <p className="font-medium text-[var(--text-1)]">
              {person.name}
              {i === 0 ? <span className="ml-2 text-xs text-[var(--text-2)]">{t(messages, "contacts.merge.keep", locale)}</span>
                : <span className="ml-2 text-xs text-[var(--text-2)]">{t(messages, "contacts.merge.joins", locale)}</span>}
            </p>
          </div>
        ))}
      </div>

      {conflicts.length > 0 ? (
        <div className="mt-6 space-y-4">
          {conflicts.map((c) => (
            <fieldset key={c.field} className="space-y-1">
              <legend className="text-sm text-[var(--text-2)]">
                {t(messages, "contacts.merge.pick", locale, { field: fieldLabel(c.field, locale) })}
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio" name={c.field} value="keep" className="accent-[var(--accent)]"
                  checked={(selected[c.field] ?? c.preselect) === "keep"}
                  onChange={() => setSelected((prev) => ({ ...prev, [c.field]: "keep" }))}
                />
                {displayValue(c.keepValue)}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio" name={c.field} value="other" className="accent-[var(--accent)]"
                  checked={(selected[c.field] ?? c.preselect) === "other"}
                  onChange={() => setSelected((prev) => ({ ...prev, [c.field]: "other" }))}
                />
                {displayValue(c.otherValue)}
              </label>
            </fieldset>
          ))}
        </div>
      ) : null}

      {alsoKeeps.length > 0 ? (
        <p className="mt-4 text-sm text-[var(--text-2)]">
          {t(messages, "contacts.merge.alsoKeeps", locale, { list: alsoKeeps.map((f) => fieldLabel(f, locale)).join(", ") })}
        </p>
      ) : null}
      {otherReach.phone ? (
        <p className="mt-2 text-sm text-[var(--text-2)]">{t(messages, "contacts.merge.otherNumber", locale, { phone: otherReach.phone, name: keep.name })}</p>
      ) : null}
      {otherReach.email ? (
        <p className="mt-2 text-sm text-[var(--text-2)]">{t(messages, "contacts.merge.otherEmail", locale, { email: otherReach.email, name: keep.name })}</p>
      ) : null}
      <p className="mt-4 text-sm text-[var(--text-2)]">
        {movesText ? t(messages, "contacts.merge.moves", locale, { name: keep.name, list: movesText }) : t(messages, "contacts.merge.nothingMoves", locale, { name: keep.name })}
      </p>

      <div className="mt-6 flex gap-2">
        <Button type="button" variant="default" disabled={busy} onClick={onMerge}>
          {t(messages, "contacts.merge.action", locale)}
        </Button>
        <Link href={contactsHref} className={cn(buttonVariants({ variant: "ghost" }))}>
          {t(messages, "common.cancel", locale)}
        </Link>
      </div>
    </div>
  );
}
