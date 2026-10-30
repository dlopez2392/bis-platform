"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { t } from "@/lib/i18n/t";
import { m as messages } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MergeChoice } from "@bis/db";
import { fieldLabel, runUndoMerge, type UndoMergeAction } from "@/lib/contacts/merge-undo";
import type { MergeActionResult } from "../merge-actions";

/**
 * F-006 part 1 (plan Task 10, Step 4; fix round): the compare screen. Two columns on a desk, the kept
 * record first; each conflicting field a radio pair; one primary button, Merge (DESIGN.md rule 8). The
 * choices sent are built ONLY from the fields actually in conflict — never the full MERGE_CHOICE_FIELDS
 * list — so a field both records already agree on is never silently re-decided. `fieldLabel` and the
 * Undo toast's own logic live in `lib/contacts/merge-undo.ts` now, shared with the timeline row's own
 * "Undo merge" ([contactId]/merge-undo.tsx) — one place, not two copies that can drift.
 */

export type Conflict = { field: string; keepValue: unknown; otherValue: unknown; preselect: MergeChoice };

/** `assigned_to` and `language` are codes, never shown raw: an id resolves through `names`
 *  (`assign.someone`/`assign.unassigned` for what the caller could not resolve), a language code
 *  through the same words the record's own Language field uses (`language.name.en`/`.es`). Every
 *  other field is the plain value, or an em dash for blank (fix round, finding #4). */
function displayValue(field: string, v: unknown, locale: Locale, names: Readonly<Record<string, string>>): string {
  if (field === "assigned_to") {
    if (v === null || v === undefined || v === "") return t(messages, "assign.unassigned", locale);
    return names[String(v)] ?? t(messages, "assign.someone", locale);
  }
  if (field === "language" && (v === "en" || v === "es")) {
    return t(messages, v === "en" ? "language.name.en" : "language.name.es", locale);
  }
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

/** What the Merge button actually sends: one choice per conflict ON SCREEN, nothing more. */
export function choicesFromConflicts(conflicts: readonly Conflict[], selected: Readonly<Record<string, MergeChoice>>): Record<string, MergeChoice> {
  return Object.fromEntries(conflicts.map((c) => [c.field, selected[c.field] ?? c.preselect]));
}

type MergeInput = { keepId: string; otherId: string; choices: Record<string, MergeChoice>; seen: { keep: string; other: string } };
type MergeAction = (input: MergeInput) => Promise<MergeActionResult>;

/**
 * Runs the merge, then wires the toast's own Undo to the MERGE ID THE ACTION RETURNED — never the
 * pair's own ids, which would ask to undo the wrong thing once more than one merge has touched either
 * record — and to `ctx.otherName`, the record the Undo gives back its OWN record (never `keepName`:
 * fix round, finding #1). Fails closed: a rejected `mergeAction` toasts `contacts.merge.failed` and
 * this still RESOLVES, never an unhandled rejection (finding #3).
 */
export async function runMerge(
  mergeAction: MergeAction, undoAction: UndoMergeAction, input: MergeInput, locale: Locale,
  ctx: { keepName: string; otherName: string; onMerged: () => void; onStale: () => void; onUndone?: () => void },
): Promise<void> {
  let r: MergeActionResult;
  try {
    r = await mergeAction(input);
  } catch {
    toast.error(t(messages, "contacts.merge.failed", locale));
    return;
  }
  if (!r.ok) {
    toast.error(t(messages, r.errorKey, locale));
    if (r.errorKey === "contacts.merge.stale") ctx.onStale();
    return;
  }
  ctx.onMerged();
  toast.success(t(messages, "contacts.merge.done", locale, { name: ctx.keepName }), {
    action: {
      label: t(messages, "common.undo", locale),
      onClick: () => void runUndoMerge(undoAction, r.mergeId, ctx.otherName, locale, ctx.onUndone ?? (() => {})),
    },
  });
}

export function MergeScreen({
  accountId, keep, other, conflicts, alsoKeeps, otherReach, movesText, seen, swapHref, locale, mergeAction, undoAction,
  assigneeNames = {},
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
  undoAction: UndoMergeAction;
  /** Clerk user id -> display name, for every `assigned_to` conflict on screen (fix round, finding
   *  #4). An id absent here (an unknown or unreadable member) reads "Someone on the team". */
  assigneeNames?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, MergeChoice>>({});
  const [busy, setBusy] = useState(false);
  const recordHref = `/dashboard/accounts/${accountId}/contacts/${keep.id}`;
  const contactsHref = `/dashboard/accounts/${accountId}/contacts`;

  // Fix round, finding #3: `runMerge` itself never throws (it catches a rejected `mergeAction`), but
  // `busy` is reset in a `finally` anyway, so a defect in that guarantee cannot leave the button
  // disabled forever.
  const onMerge = () => {
    setBusy(true);
    void (async () => {
      try {
        await runMerge(
          mergeAction, undoAction,
          { keepId: keep.id, otherId: other.id, choices: choicesFromConflicts(conflicts, selected), seen },
          locale,
          {
            keepName: keep.name,
            otherName: other.name,
            onMerged: () => router.push(recordHref),
            onStale: () => router.refresh(),
          },
        );
      } finally {
        setBusy(false);
      }
    })();
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
                {displayValue(c.field, c.keepValue, locale, assigneeNames)}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio" name={c.field} value="other" className="accent-[var(--accent)]"
                  checked={(selected[c.field] ?? c.preselect) === "other"}
                  onChange={() => setSelected((prev) => ({ ...prev, [c.field]: "other" }))}
                />
                {displayValue(c.field, c.otherValue, locale, assigneeNames)}
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
