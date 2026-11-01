"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatDateInZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContactsView } from "@/lib/contacts/view";
import { archiveContactsAction, restoreContactsAction, type ArchiveActionResult } from "./archive-actions";
import { bulkDeleteContactsAction, countContactDocumentsAction } from "./actions";
import {
  DeleteFilesLine, announceDeleteResult, latestCountSettler, readDeleteBlockers, type BlockersState, type FilesState,
} from "./bulk-action-bar";

/**
 * The record header's and the drawer's Archive, Restore and delete-for-good (contact archive, plan Task 11;
 * owner rulings 2026-10-28). Archive and Restore run at once with an Undo (rule 6); delete for good is
 * confirmed by typing the contact's name, and only for a contact with nothing but internal work on it
 * (spec §5): one with a history is archive-only, and the dialog says so before anything happens.
 *
 * The list's bulk bar owns the same actions for a selection (bulk-action-bar.tsx); this file reuses its
 * blockers read, its file line, its newest-answer guard and its delete announcement rather than a copy.
 */

type Fail = Extract<ArchiveActionResult, { ok: false }>["errorKey"];
type PartialKey = "contacts.archive.partial" | "contacts.restore.partial";

/** "The last four digits of their phone": digits only, and only when there are four. */
export function lastFourDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * What the person types to delete for good: the contact's name; with none, the phone's last four digits
 * (contacts.delete.oneBodyNoName). A contact with neither (an email-only import) types its email, and one
 * with nothing at all types the label the header shows, so there is always something to type and the
 * dialog never asks for an empty string.
 */
export function deleteConfirmToken(
  c: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null }, label: string,
): { name: string | null; digits: string | null } {
  const raw = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  const digits = lastFourDigits(c.phone);
  if (raw) return { name: raw, digits };
  if (digits) return { name: null, digits };
  return { name: c.email?.trim() || label, digits: null };
}

/** Exact, trimmed and case-SENSITIVE against the name; the last four digits when there is no name. Nothing
 *  to type never confirms. */
export function confirmTyped(typed: string, name: string | null, digits: string | null): boolean {
  const want = name?.trim() || (name === null ? digits : null);
  return Boolean(want) && typed.trim() === want;
}

/**
 * Archive from the record or the drawer: at once, said by name, with an Undo that restores exactly what this
 * call changed (never a contact that was archived before: D-007's rule). An upcoming appointment stays and its
 * reminders still go (owner ruling Q2), so the toast names its date in the account's zone. A plain async
 * function, so its toasts are testable without a DOM.
 */
export async function archiveOne(
  accountId: string, contactId: string, label: string,
  ctx: { timezone: string; locale: Locale; onDone: () => void; onUndone?: () => void },
): Promise<void> {
  const { locale } = ctx;
  let r: ArchiveActionResult;
  try {
    r = await archiveContactsAction(accountId, [contactId]);
  } catch {
    toast.error(t(m, "contacts.archive.failed", locale)); // a stale tab after a redeploy, or the network
    return;
  }
  if (!r.ok) { toast.error(t(m, r.errorKey, locale)); return; }
  ctx.onDone();
  const message = t(m, "record.archivedToast", locale, { name: label });
  const description = r.nextAppointment
    ? t(m, "contacts.archive.keepsAppointment", locale, { date: formatDateInZone(r.nextAppointment.startsAt, ctx.timezone, locale) })
    : undefined;
  const changed = r.changedIds;
  if (changed.length === 0) { toast.success(message, description ? { description } : undefined); return; }
  toast.success(message, {
    ...(description ? { description } : {}),
    action: { label: t(m, "common.undo", locale), onClick: () => void undoWith(restoreContactsAction, accountId, changed, "contacts.restore.failed", "contacts.restore.partial", locale, ctx.onUndone) },
  });
  // The bulk bar's shape (Task 10 review I2): an answer in part says so AFTER the line that carries the Undo.
  if (r.partial) toast.error(t(m, "contacts.archive.partial", locale));
}

/** Restore from the banner: the same shape, its Undo archiving exactly what it restored. */
export async function restoreOne(
  accountId: string, contactId: string, label: string,
  ctx: { locale: Locale; onDone: () => void; onUndone?: () => void },
): Promise<void> {
  const { locale } = ctx;
  let r: ArchiveActionResult;
  try {
    r = await restoreContactsAction(accountId, [contactId]);
  } catch {
    toast.error(t(m, "contacts.restore.failed", locale));
    return;
  }
  if (!r.ok) { toast.error(t(m, r.errorKey, locale)); return; }
  ctx.onDone();
  const message = t(m, "record.restoredToast", locale, { name: label });
  const changed = r.changedIds;
  if (changed.length === 0) { toast.success(message); return; }
  toast.success(message, {
    action: { label: t(m, "common.undo", locale), onClick: () => void undoWith(archiveContactsAction, accountId, changed, "contacts.archive.failed", "contacts.archive.partial", locale, ctx.onUndone) },
  });
  if (r.partial) toast.error(t(m, "contacts.restore.partial", locale));
}

async function undoWith(
  action: typeof archiveContactsAction, accountId: string, ids: string[], onThrow: Fail, partialKey: PartialKey,
  locale: Locale, onUndone?: () => void,
): Promise<void> {
  try {
    const u = await action(accountId, ids);
    if (!u.ok) { toast.error(t(m, u.errorKey, locale)); return; }
    if (u.partial) toast.error(t(m, partialKey, locale));
    onUndone?.();
  } catch {
    toast.error(t(m, onThrow, locale));
  }
}

/** The dialog's two reads, in order: what blocks this contact, then (only when nothing does) its files. A
 *  kept contact's files stay with it, so counting them would put an untrue number on the screen. */
export async function readOneDelete(accountId: string, contactId: string): Promise<{ blockers: BlockersState; files: FilesState }> {
  const blockers = await readDeleteBlockers(accountId, [contactId]);
  if (blockers.status !== "ready") return { blockers, files: { status: "loading" } };
  if (blockers.kept.includes(contactId)) return { blockers, files: { status: "ready", count: 0 } };
  const files: FilesState = await countContactDocumentsAction(accountId, [contactId])
    .then((r): FilesState => (r.ok ? { status: "ready", count: r.count } : { status: "error" }))
    .catch((): FilesState => ({ status: "error" }));
  return { blockers, files };
}

export type DeleteOneView = "loading" | "error" | "blocked" | "deletable";
export function deleteOneView(blockers: BlockersState, contactId: string): DeleteOneView {
  if (blockers.status !== "ready") return blockers.status;
  return blockers.kept.includes(contactId) ? "blocked" : "deletable";
}

/**
 * Delete for good. Never sent unless the blockers read said nothing blocks this contact. The server reads the
 * blockers again inside its own lock: a contact that gained a history since is kept, and the dialog turns
 * archive-only ("blocked") with nobody leaving the page. Answers what the dialog shows next.
 */
export async function deleteOne(
  accountId: string, contactId: string, blockers: BlockersState,
  ctx: { locale: Locale; timezone: string; onGone: () => void; view: ContactsView },
): Promise<"deleted" | "blocked" | "failed"> {
  const { locale } = ctx;
  const state = deleteOneView(blockers, contactId);
  if (state !== "deletable") return state === "blocked" ? "blocked" : "failed";
  // The bar announcement, for the one contact; which view it is in decides only the kept line, which this
  // function says itself (below). A named object, not a literal at each call.
  const announce = { accountId, timezone: ctx.timezone, view: ctx.view };
  let r: Awaited<ReturnType<typeof bulkDeleteContactsAction>>;
  try {
    r = await bulkDeleteContactsAction(accountId, [contactId], locale);
  } catch {
    toast.error(t(m, "inline.crashed", locale));
    return "failed";
  }
  if (!r.ok) { announceDeleteResult(r, locale, announce); return "failed"; }
  if (r.deleted === 0) {
    if (r.skippedBlocked > 0) {
      if (r.lateKept > 0) toast.error(t(m, "contacts.delete.filesGoneKept", locale));
      return "blocked";
    }
    // Kept because its files could not all be removed: the bar's own line says so.
    announceDeleteResult(r, locale, announce);
    return "failed";
  }
  announceDeleteResult(r, locale, announce);
  ctx.onGone();
  return "deleted";
}

/** The delete dialog's words for one contact. Rendered inside the dialog; exported so each state's words are
 *  testable without a DOM. */
export function DeleteOneBody({ view, files, label, name, digits, typed, onTyped, locale, paused = false }: {
  view: DeleteOneView; files: FilesState; label: string; name: string | null; digits: string | null;
  typed: string; onTyped: (next: string) => void; locale: Locale;
  /** A paused account refuses every delete (final review M3): the dialog says so, and Delete stays off. */
  paused?: boolean;
}) {
  const title = t(m, "contacts.delete.oneTitle", locale, { name: label });
  const body = name !== null
    ? t(m, "contacts.delete.oneBody", locale, { name })
    : t(m, "contacts.delete.oneBodyNoName", locale, { digits: digits ?? "" });
  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words">{title}</DialogTitle>
        {view === "loading" ? (
          // Rule 7: reading is a skeleton shaped like the two lines it becomes, never a spinner.
          <div data-delete-one-skeleton className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : view === "error" ? (
          // Rule 5: a failed read says so, and Delete stays off.
          <DialogDescription data-delete-one="error" className="text-[var(--crit)]">{t(m, "contacts.delete.blockersFailed", locale)}</DialogDescription>
        ) : view === "blocked" ? (
          <DialogDescription data-delete-one="blocked">{t(m, "contacts.delete.archiveOnly", locale, { name: label })}</DialogDescription>
        ) : (
          <>
            <DialogDescription data-delete-one="deletable" className="break-words">{body}</DialogDescription>
            <DeleteFilesLine state={files} locale={locale} />
            {paused ? <p data-delete-paused className="text-sm text-muted-foreground">{t(m, "contacts.delete.paused", locale)}</p> : null}
          </>
        )}
      </DialogHeader>
      {view === "deletable" ? (
        <Input value={typed} onChange={(e) => onTyped(e.target.value)} placeholder={name ?? digits ?? ""}
          aria-label={title} autoComplete="off" spellCheck={false} />
      ) : null}
    </>
  );
}

/** The record's delete dialog footer (final review M8: rendered in a test). Cancel; then, for a blocked contact,
 *  "Archive instead" (the bulk dialog's own key, so both dialogs say it the same way) unless it is archived
 *  already; else the destructive Delete, on only with the typed name and never on a paused account (M3). */
export function DeleteOneFooter({ view, archived, canArchive, canConfirm, paused, locale, onCancel, onArchiveInstead, onDelete }: {
  view: DeleteOneView; archived: boolean; canArchive: boolean; canConfirm: boolean; paused: boolean; locale: Locale;
  onCancel: () => void; onArchiveInstead: () => void; onDelete: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>{t(m, "common.cancel", locale)}</Button>
      {view === "blocked" ? (
        // Archive-only (spec §5.4): the way out it offers, when there is one. No word "delete" here.
        canArchive && !archived ? (
          <Button type="button" variant="outline" data-archive-action="archive-instead" onClick={onArchiveInstead}>
            <Archive className="size-4" aria-hidden />
            {t(m, "contacts.delete.archiveInstead", locale)}
          </Button>
        ) : null
      ) : (
        <Button type="button" variant="destructive" disabled={!canConfirm || paused} onClick={onDelete}>
          {t(m, "record.delete", locale)}
        </Button>
      )}
    </DialogFooter>
  );
}

/** A second press while the first is still answering is ignored (final review M9). A ref, not state: two quick
 *  clicks share one render. Never `disabled` while running instead: a disabled button drops focus. */
export async function runOnce(running: { current: boolean }, fn: () => Promise<void>): Promise<void> {
  if (running.current) return;
  running.current = true;
  try { await fn(); } finally { running.current = false; }
}

/** The archived state (rule 3): a dot and the word, which opens the line. When, in the account's zone, and by
 *  whom on the record page; the drawer's quick look says only when. */
export function ArchivedBanner({ archived, timezone, variant, locale }: {
  archived: { at: string; byLabel: string | null } | null; timezone: string; variant: "page" | "drawer"; locale: Locale;
}) {
  if (!archived) return null;
  const date = formatDateInZone(archived.at, timezone, locale);
  const text = variant === "page" && archived.byLabel
    ? t(m, "record.archivedBanner", locale, { date, name: archived.byLabel })
    : t(m, "record.archivedBannerShort", locale, { date });
  return (
    <p data-archived-banner className="flex min-w-0 items-baseline gap-2 text-sm text-muted-foreground">
      <span data-status-dot aria-hidden="true" className="size-[7px] shrink-0 translate-y-[-1px] rounded-full bg-[var(--text-3)]" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

/**
 * The header's controls: Archive (or Restore once archived) and Delete…, all ghost, so Call stays the
 * header's one primary (rule 8). On a phone (and always in the drawer, which is at most 448px wide) each is an
 * icon with its word for screen readers, so the row fits beside the name at 375px and survives the
 * pseudo-locale's +35%; from the small breakpoint up the page shows the words.
 */
export function ArchiveControls({
  accountId, contactId, label, contact, archived, canArchive, canDelete, timezone, variant, onGone, paused = false,
}: {
  accountId: string; contactId: string;
  /** The name the header shows (contactDisplayName): toasts and the dialog's title. */
  label: string;
  /** What the person types to delete for good is read off these (deleteConfirmToken), HERE: a server page
   *  cannot call a function exported from a "use client" module, only render its components. */
  contact: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
  archived: { at: string; byLabel: string | null } | null;
  /** Owners, Staff and the agency (seesWholeAccount); a Technician never (owner ruling Q3). */
  canArchive: boolean;
  /** Owner and agency only (canManage). */
  canDelete: boolean;
  /** The account's resolved zone: the Archive toast's appointment date reads in it. */
  timezone: string;
  variant: "page" | "drawer";
  /** The drawer: the contact leaves the list it was opened from (archive, restore, delete). */
  onGone?: () => void;
  /** The account is paused (billingVerdictFor): Delete stays off and the dialog says why (final review M3). */
  paused?: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const { name, digits: phoneLast4 } = deleteConfirmToken(contact, label);
  // A second press while the first is still answering is ignored (a ref: two quick clicks share one render).
  const running = useRef(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [blockers, setBlockers] = useState<BlockersState>({ status: "loading" });
  const [files, setFiles] = useState<FilesState>({ status: "loading" });
  const seq = useRef(0);
  // The page re-reads itself (the banner comes and goes); the drawer's contact leaves the list it is on.
  const changed = variant === "drawer" ? () => onGone?.() : () => router.refresh();
  const labelClass = variant === "drawer" ? "sr-only" : "sr-only sm:not-sr-only";
  const buttonClass = cn("min-h-11 min-w-11 md:min-h-8 md:min-w-8", variant === "page" && "sm:px-3");

  const run = (fn: () => Promise<void>) => runOnce(running, fn);
  const archive = () => run(() => archiveOne(accountId, contactId, label, { timezone, locale, onDone: changed, onUndone: () => router.refresh() }));
  const restore = () => run(() => restoreOne(accountId, contactId, label, { locale, onDone: changed, onUndone: () => router.refresh() }));

  function openDelete(next: boolean) {
    setOpen(next);
    setTyped("");
    if (!next) return;
    // Only the newest opening's answer may land (bulk-action-bar's guard).
    const settle = latestCountSettler<{ blockers: BlockersState; files: FilesState }>(seq, (r) => { setBlockers(r.blockers); setFiles(r.files); });
    setBlockers({ status: "loading" });
    setFiles({ status: "loading" });
    void readOneDelete(accountId, contactId).then(settle);
  }

  // Through `run`, like Archive and Restore: a double click sends one delete (final review M9).
  const confirmDelete = () => run(async () => {
    const gone = variant === "drawer" ? () => onGone?.() : () => router.push(`/dashboard/accounts/${accountId}/contacts`);
    const next = await deleteOne(accountId, contactId, blockers, {
      locale, timezone, view: archived ? "archived" : "active", onGone: () => { setOpen(false); gone(); },
    });
    if (next === "blocked") setBlockers({ status: "ready", kept: [contactId] });
  });

  const view = deleteOneView(blockers, contactId);
  const filesReady = files.status === "ready";
  const canConfirm = view === "deletable" && filesReady && confirmTyped(typed, name, phoneLast4);

  return (
    <span data-archive-controls className="inline-flex items-center gap-1">
      {/* One slot for Archive and Restore: when the page re-reads and one becomes the other, React keeps the same
          button, so keyboard focus stays where it was. Never `disabled` while running (a disabled button drops
          focus); `run` ignores a second press instead. */}
      {canArchive ? (
        archived ? (
          <Button type="button" variant="ghost" size="sm" className={buttonClass} data-archive-action="restore"
            title={t(m, "record.restore", locale)} onClick={() => void restore()}>
            <ArchiveRestore className="size-4" aria-hidden />
            <span className={labelClass}>{t(m, "record.restore", locale)}</span>
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" className={buttonClass} data-archive-action="archive"
            title={t(m, "record.archive", locale)} onClick={() => void archive()}>
            <Archive className="size-4" aria-hidden />
            <span className={labelClass}>{t(m, "record.archive", locale)}</span>
          </Button>
        )
      ) : null}
      {canDelete ? (
        <Dialog open={open} onOpenChange={openDelete}>
          {/* A Trigger, so Esc and Cancel give focus back to this button (Radix returns it to the trigger). */}
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className={buttonClass} data-archive-action="delete"
              title={t(m, "record.delete", locale)}>
              <Trash2 className="size-4" aria-hidden />
              <span className={labelClass}>{t(m, "record.delete", locale)}</span>
            </Button>
          </DialogTrigger>
          {/* Portaled to the body, outside the page's lang wrapper. */}
          <DialogContent lang={locale} closeLabel={t(m, "common.close", locale)}>
            <DeleteOneBody view={view} files={files} label={label} name={name} digits={phoneLast4}
              typed={typed} onTyped={setTyped} locale={locale} paused={paused} />
            <DeleteOneFooter view={view} archived={archived !== null} canArchive={canArchive} canConfirm={canConfirm}
              locale={locale}
              onCancel={() => openDelete(false)}
              onArchiveInstead={() => { openDelete(false); void archive(); }}
              onDelete={() => void confirmDelete()}
              paused={paused} />
          </DialogContent>
        </Dialog>
      ) : null}
    </span>
  );
}
