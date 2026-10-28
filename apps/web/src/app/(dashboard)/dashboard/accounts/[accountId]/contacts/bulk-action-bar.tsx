"use client";

import { useRef, useState } from "react";
import { Archive, ArchiveRestore, Trash2, Tag, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_CONTACT_BATCH } from "@bis/db";
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
import type { ContactsView } from "@/lib/contacts/view";
import { formatDateInZone } from "@/lib/format";
import {
  bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction, assignContactsAction, undoAssignContactsAction,
  countContactDocumentsAction,
} from "./actions";
import {
  archiveContactsAction, restoreContactsAction, contactDeleteBlockersAction, type ArchiveActionResult,
} from "./archive-actions";

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
  locale: Locale = "en",
): Promise<
  | { ok: true; applied: number; undo: () => Promise<{ ok: true } | { ok: false; error: string }> }
  | { ok: false; error: string }
> {
  const r = await bulkAddTagAction(accountId, ids, name).catch(
    () => ({ ok: false as const, error: t(m, "inline.crashed", locale) }));
  if (!r.ok) return r;
  return { ok: true, applied: r.applied, undo: () => bulkRemoveTagAction(accountId, r.addedIds, r.tagId) };
}

/** The "Assign to…" menu (F-085, spec §9): Unassigned first, then each person by name, the field's own order. */
export function bulkAssignChoices(members: { userId: string; label: string }[], locale: Locale = "en"): { assignee: string | null; label: string }[] {
  return [{ assignee: null, label: t(m, "assign.unassigned", locale) }, ...members.map((p) => ({ assignee: p.userId, label: p.label }))];
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
  // F-085 follow-up (Task B): the reader's own language, now that the
  // contacts list resolves one (requestLocale) — defaults to "en" so a
  // caller that hasn't been updated yet keeps today's behaviour.
  locale: Locale = "en",
): Promise<void> {
  let r: Awaited<ReturnType<typeof assignContactsAction>>;
  try {
    r = await assignContactsAction(accountId, ids, assignee);
  } catch {
    toast.error(t(m, "assign.failed", locale));
    return;
  }
  if (!r.ok) { toast.error(t(m, r.error, locale)); return; }
  onDone();
  // plural() picks the One twin by the locale's own rule.
  const message = assignee === null
    ? plural(m, "assign.bulkUnassigned", ids.length, locale, { count: ids.length })
    : plural(m, "assign.bulkDone", ids.length, locale, { count: ids.length, name });
  const previous = r.previous;
  if (previous.length === 0) { toast.success(message); return; }
  toast.success(message, {
    duration: ASSIGN_TOAST_MS,
    action: {
      label: t(m, "assign.undo", locale),
      onClick: () => void undoAssignContactsAction(accountId, previous)
        .then((u) => { if (!u.ok) toast.error(t(m, u.error, locale)); })
        .catch(() => toast.error(t(m, "assign.failed", locale))),
    },
  });
}

/**
 * A selection survives a page change (DESIGN.md, Paged lists), so it can be bigger than one archive,
 * restore, blockers read or delete may take: MAX_CONTACT_BATCH, 0103's own cap, which every one of them
 * refuses past before any query. The bar sends a bigger selection in calls of that size, one after another.
 */
export function inChunks<T>(items: readonly T[], size: number = MAX_CONTACT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ArchiveFailKey = Extract<ArchiveActionResult, { ok: false }>["errorKey"];
type ArchiveRun = {
  changedIds: string[];
  nextAppointment: { contactId: string; startsAt: string } | null;
  withAppointments: number;
  /** The first call that failed, after which nothing more was sent; null when every call answered. */
  failed: ArchiveFailKey | null;
  /** Some went and some did not (Task 10 review I2): a call failed after earlier ones changed contacts, or a
   *  call answered only in part (the server's ContactBatchError). The success line says what changed; the
   *  partial line says the rest did not. */
  partial: boolean;
};

/** Archive or Restore over the whole selection, in calls of MAX_CONTACT_BATCH. A call that fails stops the
 *  run; what the calls before it changed is still answered, so the Undo covers exactly that. */
async function runArchive(
  action: typeof archiveContactsAction, accountId: string, ids: readonly string[], onThrow: ArchiveFailKey,
): Promise<ArchiveRun> {
  const run: ArchiveRun = { changedIds: [], nextAppointment: null, withAppointments: 0, failed: null, partial: false };
  for (const chunk of inChunks(ids)) {
    let r: ArchiveActionResult;
    try {
      r = await action(accountId, chunk);
    } catch {
      run.failed = onThrow; // a stale tab after a redeploy, or the network
      break;
    }
    if (!r.ok) { run.failed = r.errorKey; break; }
    run.changedIds.push(...r.changedIds);
    run.withAppointments += r.withAppointments;
    if (r.nextAppointment) run.nextAppointment = r.nextAppointment;
    if (r.partial) { run.partial = true; break; }
  }
  if (run.failed && run.changedIds.length > 0) run.partial = true;
  // "They still have an appointment on {date}" speaks of ONE customer: only when exactly one changed.
  if (run.changedIds.length !== 1) run.nextAppointment = null;
  return run;
}

/** The failure a run ends with, in words: nothing changed is the plain failure; some changed is the partial
 *  line, said AFTER the success line that counts what did change and carries its Undo. */
function sayRunFailure(run: ArchiveRun, partialKey: "contacts.archive.partial" | "contacts.restore.partial", locale: Locale): void {
  if (run.partial) toast.error(t(m, partialKey, locale));
  else if (run.failed) toast.error(t(m, run.failed, locale));
}

/**
 * Archive from the list (contact archive, plan Task 10; owner rulings 2026-10-28): runs at once, clears the
 * selection, and says so with an Undo that restores EXACTLY the contacts this archive changed (never one
 * that was archived before: D-007's rule). An upcoming appointment stays and its reminders still go (Q2),
 * so the toast says so, the date in the account's zone and the reader's language. Nothing changed still
 * confirms, with no Undo. A plain async function, so its toasts are testable without a DOM.
 */
export async function archiveSelected(
  accountId: string, ids: string[], onDone: () => void, timezone: string, locale: Locale = "en",
): Promise<void> {
  const run = await runArchive(archiveContactsAction, accountId, ids, "contacts.archive.failed");
  if (run.failed && run.changedIds.length === 0) { toast.error(t(m, run.failed, locale)); return; }
  onDone();
  const changed = run.changedIds;
  const message = plural(m, "bulk.archived", changed.length, locale, { count: changed.length });
  const description = run.nextAppointment
    ? t(m, "contacts.archive.keepsAppointment", locale, { date: formatDateInZone(run.nextAppointment.startsAt, timezone, locale) })
    : run.withAppointments > 0
      ? plural(m, "contacts.archive.keepsAppointments", run.withAppointments, locale, { count: run.withAppointments })
      : undefined;
  if (changed.length === 0) { toast.success(message, description ? { description } : undefined); return; }
  toast.success(message, {
    ...(description ? { description } : {}),
    action: {
      label: t(m, "common.undo", locale),
      onClick: () => void runArchive(restoreContactsAction, accountId, changed, "contacts.restore.failed")
        .then((u) => sayRunFailure(u, "contacts.restore.partial", locale)),
    },
  });
  if (run.partial) sayRunFailure(run, "contacts.archive.partial", locale);
}

/** Restore from the Archived view: the same shape, its Undo archiving exactly what it restored. */
export async function restoreSelected(
  accountId: string, ids: string[], onDone: () => void, locale: Locale = "en",
): Promise<void> {
  const run = await runArchive(restoreContactsAction, accountId, ids, "contacts.restore.failed");
  if (run.failed && run.changedIds.length === 0) { toast.error(t(m, run.failed, locale)); return; }
  onDone();
  const changed = run.changedIds;
  const message = plural(m, "bulk.restored", changed.length, locale, { count: changed.length });
  if (changed.length === 0) { toast.success(message); return; }
  toast.success(message, {
    action: {
      label: t(m, "common.undo", locale),
      onClick: () => void runArchive(archiveContactsAction, accountId, changed, "contacts.archive.failed")
        .then((u) => sayRunFailure(u, "contacts.archive.partial", locale)),
    },
  });
  if (run.partial) sayRunFailure(run, "contacts.restore.partial", locale);
}

/** Which of the selection the delete would keep (spec §5.4): a contact with a history with the business is
 *  archive-only. Read when the dialog opens; Delete stays off until it is known. */
export type BlockersState = { status: "loading" } | { status: "ready"; kept: string[] } | { status: "error" };

/** The blockers for the whole selection, in calls of MAX_CONTACT_BATCH. Any call that fails, or throws, is the
 *  error state: never a partial answer, which would read the unread ones as "nothing blocks". */
export async function readDeleteBlockers(accountId: string, ids: readonly string[]): Promise<BlockersState> {
  const kept = new Set<string>();
  for (const chunk of inChunks(ids)) {
    const r = await contactDeleteBlockersAction(accountId, chunk).catch(() => ({ ok: false as const }));
    if (!r.ok) return { status: "error" };
    for (const id of Object.keys(r.blocked)) kept.add(id);
  }
  return { status: "ready", kept: [...kept] };
}

/** The selection less the contacts the delete would keep. */
export function deletableIds(ids: readonly string[], blockers: Extract<BlockersState, { status: "ready" }>): string[] {
  const kept = new Set(blockers.kept);
  return ids.filter((id) => !kept.has(id));
}

/** How many of `count` selected the delete would remove: the selection while the blockers load. */
function deletableCount(count: number, blockers: BlockersState): number {
  return blockers.status === "ready" ? Math.max(0, count - new Set(blockers.kept).size) : count;
}

/** The delete dialog's kept line (spec §5.4): how many stay and why, before anything happens. */
export function DeleteKeptLine({ state, locale }: { state: BlockersState; locale: Locale }) {
  // Rule 7: reading is a skeleton shaped like the line, never a spinner.
  if (state.status === "loading") return <Skeleton data-delete-kept-skeleton className="h-4 w-56" />;
  // Rule 5: a failed read says so (and Delete stays off), never a silent "nothing is kept".
  if (state.status === "error") {
    return <p data-delete-kept="error" className="text-sm text-[var(--crit)]">{t(m, "contacts.delete.blockersFailed", locale)}</p>;
  }
  if (state.kept.length === 0) return null;
  return (
    <p data-delete-kept={state.kept.length} className="text-sm text-card-foreground">
      {plural(m, "contacts.delete.someKept", state.kept.length, locale, { kept: state.kept.length })}
    </p>
  );
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

/**
 * Delete needs the blockers read AND the file count, and then the typed number of contacts that WILL go
 * (spec §5.4): the selection (`count`) less the ones kept, never the selection itself. Nothing deletable
 * never enables it. The dialog must say what is kept and how many files go before anything goes.
 */
export function canConfirmDelete(typed: string, count: number, files: FilesState, blockers: BlockersState): boolean {
  if (blockers.status !== "ready" || files.status !== "ready") return false;
  const deletable = deletableCount(count, blockers);
  return deletable > 0 && typed.trim() === String(deletable);
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

/**
 * One opening of the delete dialog: claims the next sequence number and answers a setter that lands
 * only while this opening is still the newest. A slow count for an earlier selection must never stand
 * in for the current one (it could enable Delete beside the wrong file line).
 */
export function latestCountSettler<S = FilesState>(
  seq: { current: number }, setFiles: (next: S) => void,
): (next: S) => void {
  const mine = ++seq.current;
  return (next) => { if (mine === seq.current) setFiles(next); };
}

type DeleteResult = Awaited<ReturnType<typeof bulkDeleteContactsAction>>;
type DeleteOk = Extract<DeleteResult, { ok: true }>;
type DeleteFail = Extract<DeleteResult, { ok: false }>;

/**
 * The delete over the whole selection, in calls of MAX_CONTACT_BATCH, summed into one answer. A call that
 * fails stops the run: what the calls before it did is still `done` (it happened, and is said), and the
 * failure is said after it. A throw (a stale tab) is the plain crashed line.
 */
export async function deleteInChunks(
  accountId: string, ids: readonly string[], locale: Locale,
): Promise<{ done: DeleteOk | null; failure: DeleteFail | null }> {
  let done: DeleteOk | null = null;
  for (const chunk of inChunks(ids)) {
    const r: DeleteResult = await bulkDeleteContactsAction(accountId, chunk).catch(
      () => ({ ok: false as const, error: t(m, "inline.crashed", locale) }));
    if (!r.ok) return { done, failure: r };
    done = done === null ? r : {
      ok: true,
      deleted: done.deleted + r.deleted,
      skippedBlocked: done.skippedBlocked + r.skippedBlocked,
      skippedFiles: done.skippedFiles + r.skippedFiles,
      skippedIds: [...done.skippedIds, ...r.skippedIds],
      lateKept: done.lateKept + r.lateKept,
    };
  }
  return { done, failure: null };
}

/**
 * What a bulk delete says afterwards. A failure after the files were already removed says exactly
 * that (contacts.delete.filesGoneKept), in the reader's language; customers kept because their files
 * could not all be removed are named after the success line. Those two file lines exist because of
 * the owner ruling of 2026-10-13 (a customer's files go with them, and the screen says how many); that
 * ruling said nothing about the success line's language. S-07 left the success line in the bar's
 * English only because translating the bar was outside its scope; the F-085 follow-up translated it
 * with the rest of the bar, through plural()/t() like every other toast this bar fires.
 *
 * Contact archive (spec §5.4, plan Task 10): a contact with a history is kept, never deleted, and the
 * line offers "Archive them", which archives EXACTLY the kept ones (`skippedIds`), never the selection.
 * A contact the database kept after its files went (`lateKept`, already inside `skippedBlocked`) also
 * gets the files-gone line.
 */
export function announceDeleteResult(
  // `view` absent is the list. A caller acting on an archived contact passes "archived", so the toast never
  // offers to archive what is archived already (Task 10 review I1).
  r: DeleteResult, locale: Locale, ctx: { accountId: string; timezone: string; view?: ContactsView },
): void {
  if (!r.ok) {
    toast.error("errorKey" in r && r.errorKey ? t(m, r.errorKey, locale) : r.error);
    return;
  }
  if (r.skippedBlocked === 0) {
    toast.success(plural(m, "bulk.deleted", r.deleted, locale, { count: r.deleted }));
  } else {
    const kept = r.skippedIds;
    const params = { count: r.deleted, skipped: r.skippedBlocked };
    // Task 10 review I1: in the Archived view the kept ones are archived already, so the line says they stay
    // archived and offers nothing. On the list it offers "Archive them". Picked by the KEPT count (I3).
    if (ctx.view === "archived") {
      toast.success(plural(m, "bulk.deletedSkippedArchived", r.skippedBlocked, locale, params));
    } else {
      toast.success(plural(m, "bulk.deletedSkipped", r.skippedBlocked, locale, params), kept.length > 0 ? {
        action: {
          label: t(m, "bulk.archiveKept", locale),
          onClick: () => void archiveSelected(ctx.accountId, kept, () => {}, ctx.timezone, locale),
        },
      } : undefined);
    }
  }
  if (r.lateKept > 0) toast.error(t(m, "contacts.delete.filesGoneKept", locale));
  if (r.skippedFiles > 0) {
    toast.error(t(m, "contacts.delete.keptFiles", locale, { count: r.deleted, kept: r.skippedFiles }));
  }
}

/**
 * The bulk delete dialog's body (spec §5.4; Task 10 review), its own component so it renders in a test with
 * the state the bar hands it. While the blockers load: the selection's count, a skeleton kept line, Delete
 * off. Once read: the title and the typed number are the count that WILL go, the kept line says how many
 * stay, and the files line counts the files of the ones that go. Nothing deletable: its own title and one
 * sentence (never "Delete 3 contacts?", and the kept line does not repeat it); on the list it offers
 * Archive instead, and in the Archived view, where they are archived already, it offers nothing.
 */
export function DeleteDialogBody({
  count, typed, onTyped, files, blockers, view, canArchive, locale, onCancel, onArchiveInstead, onDelete,
}: {
  /** The selection's size. */
  count: number;
  typed: string;
  onTyped: (next: string) => void;
  files: FilesState;
  blockers: BlockersState;
  view: ContactsView;
  canArchive: boolean;
  locale: Locale;
  onCancel: () => void;
  onArchiveInstead: () => void;
  onDelete: () => void;
}) {
  const deletable = deletableCount(count, blockers);
  const none = blockers.status === "ready" && deletable === 0;
  const copy = deleteDialogCopy(deletable, locale);
  const archived = view === "archived";
  const title = none ? plural(m, "contacts.delete.noneTitle", count, locale) : copy.title;
  const body = none
    ? plural(m, archived ? "contacts.delete.noneDeletableArchived" : "contacts.delete.noneDeletable", count, locale)
    : copy.body;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
        {none ? null : <DeleteKeptLine state={blockers} locale={locale} />}
        {blockers.status === "ready" && !none ? <DeleteFilesLine state={files} locale={locale} /> : null}
      </DialogHeader>
      {none ? null : (
        <Input
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          placeholder={String(deletable)}
          aria-label={copy.title}
        />
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {copy.cancel}
        </Button>
        {none ? (
          // Archive-only (spec §5.4). No word "delete" here, so the e2e's /delete/i button locators still
          // find only the Delete pair. Never in the Archived view: they are archived already (review I1).
          canArchive && !archived ? (
            <Button variant="outline" data-bulk-action="archive-instead" onClick={onArchiveInstead}>
              <Archive className="size-3.5" aria-hidden />
              {t(m, "contacts.delete.archiveInstead", locale)}
            </Button>
          ) : null
        ) : (
          <Button
            variant="destructive"
            disabled={!canConfirmDelete(typed, count, files, blockers)}
            onClick={onDelete}
          >
            {copy.confirm}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export function BulkActionBar({
  accountId, selectedIds, existingTags, canDelete, onDone, canAssign = false, members = [],
  view, canArchive, timezone,
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
  /** Contact archive (plan Task 10): the list offers Archive, its Archived view Restore. */
  view: ContactsView;
  /** Owners, Staff and the agency archive and restore (seesWholeAccount); a Technician never does, and
   *  keeps the bar for tagging (rule 4). */
  canArchive: boolean;
  /** The account's resolved zone: the Archive toast's appointment date reads in it. */
  timezone: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [files, setFiles] = useState<FilesState>({ status: "loading" });
  const [blockers, setBlockers] = useState<BlockersState>({ status: "loading" });
  // Only the newest count may land: a slow answer for an earlier opening must not stand in for this one.
  const countSeq = useRef(0);
  const blockersSeq = useRef(0);
  const locale = useLocale();
  const count = selectedIds.length;
  if (count === 0) return null;
  // The delete's toasts know the view: the Archived view never offers to archive (Task 10 review I1).
  const ctx = { accountId, timezone, view };
  // plural() picks bulk.selectedOne at one: "1 seleccionado", never "1 seleccionados".
  const selectedText = plural(m, "bulk.selected", count, locale, { count });

  async function applyTag(name: string) {
    const ids = [...selectedIds];
    const r = await applyBulkTag(accountId, ids, name, locale);
    if (!r.ok) { toast.error(r.error); return; }
    onDone();
    toast.success(
      plural(m, "bulk.tagged", r.applied, locale, { count: r.applied, tag: name }),
      {
        action: {
          label: t(m, "common.undo", locale),
          onClick: () => void r.undo()
            .then((u) => { if (!u.ok) toast.error(u.error); })
            .catch(() => toast.error(t(m, "inline.crashed", locale))),
        },
      },
    );
  }

  function openConfirm() {
    const ids = [...selectedIds];
    const settle = latestCountSettler(countSeq, setFiles);
    const settleBlockers = latestCountSettler<BlockersState>(blockersSeq, setBlockers);
    setFiles({ status: "loading" });
    setBlockers({ status: "loading" });
    setConfirmOpen(true);
    // What is kept first, then the files of the ones that WILL go: a kept customer's files stay with
    // them, so counting those would put a number on the screen that is not true.
    void readDeleteBlockers(accountId, ids).then((b) => {
      settleBlockers(b);
      if (b.status !== "ready") return;
      const go = deletableIds(ids, b);
      if (go.length === 0) { settle({ status: "ready", count: 0 }); return; }
      return countContactDocumentsAction(accountId, go)
        .then((r) => settle(r.ok ? { status: "ready", count: r.count } : { status: "error" }))
        .catch(() => settle({ status: "error" }));
    });
  }

  function closeConfirm() {
    setConfirmOpen(false);
    setTyped("");
  }

  async function doDelete() {
    const ids = [...selectedIds];
    closeConfirm();
    // The whole selection goes to the server, which reads the blockers again inside its own lock: one that
    // gained a history since the dialog read them is kept, and said so, with "Archive them".
    const { done, failure } = await deleteInChunks(accountId, ids, locale);
    if (done) {
      onDone();
      announceDeleteResult(done, locale, ctx);
    }
    if (failure) announceDeleteResult(failure, locale, ctx);
  }

  // This renders as the FIRST CHILD of the contacts `ListPanel`, so the
  // bordered, radiused, card-filled box that used to be here was a card
  // floating inside a card. It is a band across the top of the panel instead:
  // ladder step 2, a `--row-line` rule below it, no radius, and no card
  // material of its own — nested surfaces never get one.
  return (
    <div
      role="toolbar"
      aria-label={selectedText}
      // Wraps (F-085 follow-ups, design I6): at phone width the actions were wider than the panel,
      // which clips, so the ones past its edge could not be reached. Each control now takes the next
      // line when it must; at desktop widths everything still fits on one.
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--row-line)] bg-[var(--surface-2)] px-4 py-2"
      data-testid="bulk-action-bar"
    >
      <span className="text-sm font-medium">
        {selectedText}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Tag className="size-3.5" aria-hidden />
            {t(m, "bulk.addTag", locale)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" lang={locale}>
          {existingTags.length > 0 && (
            <>
              {existingTags.map((tag) => (
                <DropdownMenuItem key={tag.id} onSelect={() => void applyTag(tag.name)}>
                  {tag.name}
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
              placeholder={t(m, "contact.addTag", locale)}
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
              {t(m, "assign.bulk", locale)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" lang={locale}>
            {bulkAssignChoices(members, locale).map((c) => (
              <DropdownMenuItem key={c.assignee ?? "none"}
                onSelect={() => void assignSelected(accountId, [...selectedIds], c.assignee, c.label, onDone, locale)}>
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* Contact archive (plan Task 10): at once, with an Undo (rule 6). The list archives; its Archived
          view restores. Neither for a Technician (owner ruling Q3), whose bar keeps Add tag (rule 4). */}
      {canArchive && view === "active" ? (
        <Button size="sm" variant="outline" data-bulk-action="archive"
          onClick={() => void archiveSelected(accountId, [...selectedIds], onDone, timezone, locale)}>
          <Archive className="size-3.5" aria-hidden />
          {t(m, "bulk.archive", locale)}
        </Button>
      ) : null}
      {canArchive && view === "archived" ? (
        <Button size="sm" variant="outline" data-bulk-action="restore"
          onClick={() => void restoreSelected(accountId, [...selectedIds], onDone, locale)}>
          <ArchiveRestore className="size-3.5" aria-hidden />
          {t(m, "bulk.restore", locale)}
        </Button>
      ) : null}

      {canDelete ? (
        <Button size="sm" variant="outline" onClick={openConfirm}>
          <Trash2 className="size-3.5" aria-hidden />
          {t(m, "bulk.delete", locale)}
        </Button>
      ) : null}

      <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onDone}
        aria-label={t(m, "bulk.clear", locale)}>
        <X className="size-3.5" aria-hidden />
      </Button>

      {canDelete ? (
        // Every way out (Esc, the X, a click outside, Cancel) goes through closeConfirm, so the typed number
        // never survives into the next opening (review minor).
        <Dialog open={confirmOpen} onOpenChange={(open) => (open ? setConfirmOpen(true) : closeConfirm())}>
          {/* The menus above and this dialog are portaled to the body, outside the list's lang wrapper. */}
          <DialogContent lang={locale} closeLabel={t(m, "common.close", locale)}>
            <DeleteDialogBody
              count={count}
              typed={typed}
              onTyped={setTyped}
              files={files}
              blockers={blockers}
              view={view}
              canArchive={canArchive}
              locale={locale}
              onCancel={closeConfirm}
              onArchiveInstead={() => { closeConfirm(); void archiveSelected(accountId, [...selectedIds], onDone, timezone, locale); }}
              onDelete={() => void doDelete()}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
