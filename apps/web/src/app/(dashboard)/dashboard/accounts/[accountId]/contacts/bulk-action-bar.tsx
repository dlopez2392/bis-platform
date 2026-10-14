"use client";

import { useRef, useState } from "react";
import { Trash2, Tag, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { plural, t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { ASSIGN_TOAST_MS } from "@/components/assign/assign-handlers";
import type { AssignMember } from "@/lib/assign/view";
import {
  bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction, assignContactsAction, undoAssignContactsAction,
  countContactDocumentsAction,
} from "./actions";

/**
 * D-007: a bulk tag's Undo must strip the tag only from the contacts that
 * did NOT already carry it — never the whole original selection, or Undo
 * removes the tag from contacts that already had it before this bulk-tag
 * ran. `addTagToContacts` (packages/db/src/contacts.ts) now reports exactly
 * that set as `addedIds`; this function is the one place that decision gets
 * wired into the Undo action, pulled out of the component below so the
 * wiring itself — not a trivial passthrough — is unit-testable without
 * going through the DropdownMenu it is triggered from (no DOM renderer in
 * apps/web; see contact-drawer.wiring.test.ts's own doc comment).
 */
export async function applyBulkTag(
  accountId: string,
  ids: string[],
  name: string,
): Promise<
  | { ok: true; applied: number; undo: () => Promise<{ ok: true } | { ok: false; error: string }> }
  | { ok: false; error: string }
> {
  const r = await bulkAddTagAction(accountId, ids, name).catch(
    () => ({ ok: false as const, error: m["inline.crashed"] }));
  if (!r.ok) return r;
  return { ok: true, applied: r.applied, undo: () => bulkRemoveTagAction(accountId, r.addedIds, r.tagId) };
}

/** The "Assign to…" menu (F-085, spec §9): Unassigned first, then each person by name, the field's own order. */
export function bulkAssignChoices(members: { userId: string; label: string }[]): { assignee: string | null; label: string }[] {
  return [{ assignee: null, label: m["assign.unassigned"] }, ...members.map((p) => ({ assignee: p.userId, label: p.label }))];
}

/**
 * A bulk "Assign to…" (F-085 part 1, spec §9, A2): runs at once, clears the
 * selection, and says so with an Undo (rule 6). The Undo hands
 * `undoAssignContactsAction` the returned `PreviousAssignee[]` WHOLE, never
 * regrouped into assign calls, which would pull the earlier holders' own
 * tasks over (Task 2 review m1). Nothing changed (`previous = []`, they
 * were all with that person already) still confirms, with no Undo. A plain
 * async function, so its toasts are testable without the DropdownMenu.
 */
export async function assignSelected(
  accountId: string, ids: string[], assignee: string | null, name: string, onDone: () => void,
): Promise<void> {
  let r: Awaited<ReturnType<typeof assignContactsAction>>;
  try {
    r = await assignContactsAction(accountId, ids, assignee);
  } catch {
    toast.error(m["assign.failed"]);
    return;
  }
  if (!r.ok) { toast.error(m[r.error]); return; }
  onDone();
  // plural() picks the One twin by the locale's own rule. These screens
  // speak English today (m, not the request locale); the .es twins are in.
  const message = assignee === null
    ? plural(m, "assign.bulkUnassigned", ids.length, "en", { count: ids.length })
    : plural(m, "assign.bulkDone", ids.length, "en", { count: ids.length, name });
  const previous = r.previous;
  if (previous.length === 0) { toast.success(message); return; }
  toast.success(message, {
    duration: ASSIGN_TOAST_MS,
    action: {
      label: m["assign.undo"],
      onClick: () => void undoAssignContactsAction(accountId, previous)
        .then((u) => { if (!u.ok) toast.error(m[u.error]); })
        .catch(() => toast.error(m["assign.failed"])),
    },
  });
}

/** The delete dialog's file line (owner ruling 2026-10-13): what else goes, in the reader's language. */
export type FilesState = { status: "loading" } | { status: "ready"; count: number } | { status: "error" };

export function DeleteFilesLine({ state, locale }: { state: FilesState; locale: Locale }) {
  // Rule 7: counting is a skeleton shaped like the line, never a spinner.
  if (state.status === "loading") return <Skeleton data-delete-files-skeleton className="h-4 w-48" />;
  // Rule 5: a failed count says so (and Delete stays off), never a silent "no files".
  if (state.status === "error") {
    return <p data-delete-files="error" className="text-sm text-[var(--crit)]">{t(m, "contacts.delete.filesFailed", locale)}</p>;
  }
  if (state.count === 0) return null;
  return (
    <p data-delete-files={state.count} className="text-sm text-card-foreground">
      {plural(m, "contacts.delete.alsoFiles", state.count, locale, { count: state.count })}
    </p>
  );
}

/** Delete needs the typed count AND a known file count: the dialog must say how many files go before anything goes. */
export function canConfirmDelete(typed: string, count: number, files: FilesState): boolean {
  return typed.trim() === String(count) && files.status === "ready";
}

/** The delete dialog's own words, in the reader's language (plan review minor 10). */
export function deleteDialogCopy(count: number, locale: Locale): { title: string; body: string; cancel: string; confirm: string } {
  return {
    title: count === 1 ? t(m, "bulk.confirmTitleOne", locale) : t(m, "bulk.confirmTitle", locale, { count }),
    body: t(m, "bulk.confirmBody", locale, { count }),
    cancel: t(m, "common.cancel", locale),
    confirm: t(m, "bulk.delete", locale),
  };
}

type DeleteResult = Awaited<ReturnType<typeof bulkDeleteContactsAction>>;

/**
 * What a bulk delete says afterwards. A failure after the files were already removed says exactly
 * that (contacts.delete.filesGoneKept), in the reader's language; customers kept because their files
 * could not all be removed are named after the success line (owner ruling 2026-10-13). The success
 * line itself is the bar's existing English copy, unchanged.
 */
export function announceDeleteResult(r: DeleteResult, locale: Locale): void {
  if (!r.ok) {
    toast.error("errorKey" in r && r.errorKey ? t(m, r.errorKey, locale) : r.error);
    return;
  }
  toast.success(
    r.skippedBlocked === 0
      ? r.deleted === 1
        ? m["bulk.deletedOne"]
        : m["bulk.deleted"].replace("{count}", String(r.deleted))
      // No plural noun in this string ("Deleted N · skipped N linked to
      // ..."), so it reads fine at any count — no singular form needed.
      : m["bulk.deletedSkipped"]
          .replace("{count}", String(r.deleted))
          .replace("{skipped}", String(r.skippedBlocked)),
  );
  if (r.skippedFiles > 0) {
    toast.error(t(m, "contacts.delete.keptFiles", locale, { count: r.deleted, kept: r.skippedFiles }));
  }
}

export function BulkActionBar({
  accountId, selectedIds, existingTags, canDelete, onDone, canAssign = false, members = [],
}: {
  accountId: string;
  selectedIds: string[];
  existingTags: { id: string; name: string }[];
  /** Staff and roles: true for the agency and a client Owner, false for
   *  Staff. Gates ONLY the Delete control and its confirm dialog — Tag and
   *  Untag stay available for Staff, so the bar never renders with no bulk
   *  action at all for a ticked checkbox (DESIGN.md rule 4). */
  canDelete: boolean;
  onDone: () => void; // clear selection in the table
  /** F-085 part 1: Owner, Staff and the agency assign customers; a
   *  Technician keeps the bar for tagging (rule 4) but never this control. */
  canAssign?: boolean;
  members?: AssignMember[];
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [files, setFiles] = useState<FilesState>({ status: "loading" });
  // Only the newest count may land: a slow answer for an earlier opening must not stand in for this one.
  const countSeq = useRef(0);
  const locale = useLocale();
  const count = selectedIds.length;
  if (count === 0) return null;
  const copy = deleteDialogCopy(count, locale);

  async function applyTag(name: string) {
    const ids = [...selectedIds];
    const r = await applyBulkTag(accountId, ids, name);
    if (!r.ok) { toast.error(r.error); return; }
    onDone();
    toast.success(
      r.applied === 1
        ? m["bulk.taggedOne"].replace("{tag}", name)
        : m["bulk.tagged"].replace("{count}", String(r.applied)).replace("{tag}", name),
      {
        action: {
          label: m["common.undo"],
          onClick: () => void r.undo()
            .then((u) => { if (!u.ok) toast.error(u.error); })
            .catch(() => toast.error(m["inline.crashed"])),
        },
      },
    );
  }

  function openConfirm() {
    const ids = [...selectedIds];
    const seq = ++countSeq.current;
    const settle = (next: FilesState) => { if (seq === countSeq.current) setFiles(next); };
    setFiles({ status: "loading" });
    setConfirmOpen(true);
    void countContactDocumentsAction(accountId, ids)
      .then((r) => settle(r.ok ? { status: "ready", count: r.count } : { status: "error" }))
      .catch(() => settle({ status: "error" }));
  }

  async function doDelete() {
    const ids = [...selectedIds];
    setConfirmOpen(false);
    setTyped("");
    const r = await bulkDeleteContactsAction(accountId, ids).catch(
      () => ({ ok: false as const, error: m["inline.crashed"] }));
    if (r.ok) onDone();
    announceDeleteResult(r, locale);
  }

  // This renders as the FIRST CHILD of the contacts `ListPanel`, so the
  // bordered, radiused, card-filled box that used to be here was a card
  // floating inside a card. It is a band across the top of the panel instead:
  // ladder step 2, a `--row-line` rule below it, no radius, and no card
  // material of its own — nested surfaces never get one.
  return (
    <div
      role="toolbar"
      aria-label={m["bulk.selected"].replace("{count}", String(count))}
      className="flex items-center gap-3 border-b border-[var(--row-line)] bg-[var(--surface-2)] px-4 py-2"
      data-testid="bulk-action-bar"
    >
      <span className="text-sm font-medium">
        {m["bulk.selected"].replace("{count}", String(count))}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Tag className="size-3.5" aria-hidden />
            {m["bulk.addTag"]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {existingTags.length > 0 && (
            <>
              {existingTags.map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => void applyTag(t.name)}>
                  {t.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <form
            className="flex items-center gap-1 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (tagDraft.trim()) { void applyTag(tagDraft.trim()); setTagDraft(""); }
            }}
          >
            <Input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={m["contact.addTag"]}
              className="h-7 w-36 text-xs"
            />
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      {canAssign ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <UserRound className="size-3.5" aria-hidden />
              {m["assign.bulk"]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {bulkAssignChoices(members).map((c) => (
              <DropdownMenuItem key={c.assignee ?? "none"}
                onSelect={() => void assignSelected(accountId, [...selectedIds], c.assignee, c.label, onDone)}>
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canDelete ? (
        <Button size="sm" variant="outline" onClick={openConfirm}>
          <Trash2 className="size-3.5" aria-hidden />
          {m["bulk.delete"]}
        </Button>
      ) : null}

      <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onDone}
        aria-label={m["bulk.clear"]}>
        <X className="size-3.5" aria-hidden />
      </Button>

      {canDelete ? (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>
                {copy.body}
              </DialogDescription>
              <DeleteFilesLine state={files} locale={locale} />
            </DialogHeader>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={String(count)}
              aria-label={copy.title}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setConfirmOpen(false); setTyped(""); }}>
                {copy.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={!canConfirmDelete(typed, count, files)}
                onClick={() => void doDelete()}
              >
                {copy.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
