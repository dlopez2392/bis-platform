"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FileText, Lock, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineField } from "@/components/inline-field";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/components/locale-provider";
import { DOCUMENT_CATEGORIES, DOCUMENT_TITLE_MAX, type DocumentCategory, type DocumentRequestItem } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t, plural } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { documentsLoadFrom, type DocumentsLoad, type DocumentView } from "@/lib/documents/documents-load";
import { rowScan, scanLabel, nextPollMs, type RowScan } from "@/lib/documents/scan-state";
import { dayDiff, expiryView, expiryText, purgeDaysLeft, purgeText } from "@/lib/documents/expiry";
import { MAX_BATCH, defaultCategory, titleFromFileName, typeForFile } from "@/lib/documents/rules";
import { browserDeps, browserVersionDeps, uploadOne, uploadVersion, type UploadBatch, type UploadPhase } from "@/lib/documents/upload-client";
import { spaceUsedText } from "@/lib/documents/space";
import type { DocumentUndo } from "./documents-actions";
import { documentHandlers, type DocumentHandlers, type FieldSave } from "./documents-card-handlers";
import { DocumentUploadPanel, type PanelFile } from "./document-upload-panel";
import { DocumentViewer, canOpen } from "./document-viewer";
import { DocumentPurgeDialog } from "./document-purge-dialog";
import { DocumentRequestDialog, type RequestChannel } from "./document-request-dialog";
import { DocumentRequestsList } from "./document-requests-list";
import {
  documentRequestsLoadFrom, documentRequestsRouteFor, type DocumentRequestsLoad,
} from "@/lib/document-requests/requests-load";

export type { DocumentHandlers } from "./documents-card-handlers";

/** The card's open requests (S-07 2b): their own read, and what the list and "Ask the customer" do. */
export type RequestsSlot = {
  load: DocumentRequestsLoad; onAsk: () => void; onRetry: () => void; onCopy: (id: string) => void; onRevoke: (id: string) => void;
};

type DocRecord = { kind: "contact" | "group"; id: string };
type Params = Record<string, string | number>;

/** The card's own read (spec 4.5): a contact's route or the group's own. */
export function documentsRouteFor(accountId: string, record: DocRecord): string {
  return record.kind === "group"
    ? `/api/accounts/${accountId}/groups/${record.id}/documents`
    : `/api/accounts/${accountId}/contacts/${record.id}/documents`;
}

/**
 * "today", "yesterday", "3 days ago" in the reader's language: whole CALENDAR days from the day the file
 * was added to the account's today, both YYYY-MM-DD in the account's zone (the route computes them), so
 * an evening upload reads "yesterday" the next morning, never "today". `dayDiff` is the expiry words'
 * own day arithmetic. A day ahead of today (clock skew) reads "today", never "tomorrow".
 */
export function addedWhen(addedOn: string, today: string, locale: Locale): string {
  const days = Math.max(0, dayDiff(addedOn, today));
  return new Intl.RelativeTimeFormat(locale === "es" ? "es-US" : "en-US", { numeric: "auto" }).format(-days, "day");
}

/**
 * "Added by Ana · 3 days ago" / "Photo taken by you · today"; a person the reader cannot name is "Someone on the team".
 * A file the customer sent through a request link reads "Sent by the customer · …" (S-07 2b): its author is the
 * customer mark, never a person on the team, so `addedBy` is not consulted for it.
 */
export function sourceLine(doc: DocumentView, today: string, locale: Locale): string {
  if (doc.source === "customer") return t(m, "documents.addedByCustomer", locale, { when: addedWhen(doc.addedOn, today, locale) });
  const name = doc.addedBy.you ? t(m, "documents.you", locale) : doc.addedBy.name ?? t(m, "assign.someone", locale);
  return t(m, doc.source === "camera" ? "documents.photoBy" : "documents.addedBy", locale, { name, when: addedWhen(doc.addedOn, today, locale) });
}

/**
 * One upload write at a time for the whole card: a batch, or one file's Retry. A second run while the
 * lock is held answers null and does nothing (a double click on Retry, or a Retry during a batch, would
 * otherwise reserve and file the same file twice). The lock is released however the run ends.
 */
export async function exclusive<T>(lock: { held: boolean }, run: () => Promise<T>): Promise<T | null> {
  if (lock.held) return null;
  lock.held = true;
  try { return await run(); } finally { lock.held = false; }
}

/**
 * What a drop (or a pick) of `count` files answers before the panel opens: refused with the wait
 * sentence while a batch or a Retry holds the upload lock (a batch on its way is never replaced, and
 * never silently), refused as too many past MAX_BATCH, otherwise null and the panel opens.
 */
export function dropRefusal(lockHeld: boolean, count: number): MessageKey | null {
  if (lockHeld) return "documents.error.busy";
  if (count > MAX_BATCH) return "documents.error.tooMany";
  return null;
}

/** The viewer's file survives a re-read only while that read still lists it (trashed elsewhere, or by this card's own menu). */
export function keepOpen(openId: string | null, load: DocumentsLoad): string | null {
  if (!openId || load.status !== "ready") return openId;
  return load.data.live.some((d) => d.id === openId) ? openId : null;
}

/**
 * Delete forever's target survives a re-read only while that read still lists it in the TRASH (final
 * review 1): purged, restored or gone elsewhere, it is forgotten, so a later re-trash of the same file
 * never reopens the dialog by itself. A failed read keeps it, as keepOpen does.
 */
export function keepPurge(purgeId: string | null, load: DocumentsLoad): string | null {
  if (!purgeId || load.status !== "ready") return purgeId;
  return load.data.trashed.some((d) => d.id === purgeId) ? purgeId : null;
}

/**
 * The row menu (spec 4.1), as data: the component maps it one to one, and the test reads it (the menu's
 * content renders in a portal only while open). Owners only is the Owner's and the agency's.
 */
export type RowMenuItem = { id: "edit" | "ownersOnly" | "newVersion" | "download" | "trash"; labelKey: MessageKey };
export function rowMenuItems(doc: DocumentView, canManage: boolean): RowMenuItem[] {
  const items: RowMenuItem[] = [{ id: "edit", labelKey: "documents.edit" }];
  if (canManage) items.push({ id: "ownersOnly", labelKey: doc.ownersOnly ? "documents.makeTeam" : "documents.makeOwnersOnly" });
  items.push({ id: "newVersion", labelKey: "documents.newVersion" });
  // S-07 2a (I2): a file not yet scanned clean has nothing to download (the server's gate refuses too),
  // via the one predicate the viewer's own Download and fetch guard share (canOpen, document-viewer.tsx).
  if (canOpen(doc.version.scan)) items.push({ id: "download", labelKey: "documents.download" });
  items.push({ id: "trash", labelKey: "documents.trash" });
  return items;
}

/** A row's inline-edit callbacks, through the handlers (PR 1a review M6): the card never calls an edit action itself. */
export function rowSavers(doc: DocumentView, handlers: Pick<DocumentHandlers, "saveField" | "undoField">): {
  save: (field: DocumentUndo["field"]) => (value: string) => Promise<FieldSave>;
  undoWith: (payload: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
} {
  return {
    save: (field) => (value) => handlers.saveField(doc, field, value),
    undoWith: (payload) => handlers.undoField(payload),
  };
}

/** What the card says when a new version's journey ends: its success, or the refusal in the reader's words. Nothing mid-way. */
export function versionToast(end: UploadPhase, title: string, locale: Locale): { ok: boolean; text: string } | null {
  if (end.kind === "done") return { ok: true, text: t(m, "documents.versionAdded", locale, { title }) };
  if (end.kind === "failed") return { ok: false, text: t(m, end.error as MessageKey, locale, end.params) };
  return null;
}

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const control = cn("min-h-11 md:min-h-8", focusRing);
const rowLine = "border-t border-[var(--row-line)] first:border-t-0";
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/webp";

/** Rule 3: 30 days away or less, or past, is a dot AND the words; further out, the words alone. */
function ExpiryLine({ expiresOn, today, locale }: { expiresOn: string | null; today: string; locale: Locale }) {
  const v = expiryView(expiresOn, today);
  if (!v) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {v.soon ? (
        <span data-expiry-dot aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", v.band === "past" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} />
      ) : null}
      {expiryText(v, locale)}
    </span>
  );
}

/** Rule 3: a scan state is a dot AND the words (spec 3.5); a clean row draws nothing. */
function ScanStatus({ scan, locale }: { scan: RowScan; locale: Locale }) {
  const label = scanLabel(scan, locale);
  if (!label || scan.kind === "ok") return null;
  return (
    <span data-document-scan={scan.kind} className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", label.tone === "crit" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} />
      {label.text}
    </span>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="break-words pt-1 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function DocumentRow({ doc, today, now, canManage, locale, handlers, phase, onOpen, onNewVersion }: {
  doc: DocumentView; today: string; now: string; canManage: boolean; locale: Locale;
  handlers: DocumentHandlers; phase: UploadPhase | null; onOpen: (d: DocumentView) => void; onNewVersion: (d: DocumentView) => void;
}) {
  const tt = (key: MessageKey, params?: Params) => t(m, key, locale, params);
  const [editing, setEditing] = useState(false);
  // Every inline edit saves at once with an Undo (rule 6); the Undo is the server's own compare-and-set.
  const { save, undoWith } = rowSavers(doc, handlers);
  const choose = (item: RowMenuItem) => {
    if (item.id === "edit") setEditing((e) => !e);
    else if (item.id === "ownersOnly") void handlers.setOwnersOnly(doc, !doc.ownersOnly);
    else if (item.id === "newVersion") onNewVersion(doc);
    else if (item.id === "download") void handlers.download(doc);
    else void handlers.trash(doc);
  };
  const progress = phase?.kind === "uploading" ? tt("documents.progress.uploading", { percent: phase.percent })
    : phase?.kind === "checking" ? tt("documents.progress.checking") : null;
  return (
    <li data-document-row={doc.id}
      className={cn("relative rounded-[var(--radius-ctl)] hover:bg-[var(--surface-3)] motion-safe:transition-colors motion-safe:duration-150", rowLine)}>
      <div className="flex items-start gap-2 px-1 py-2">
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {/* The whole row opens the viewer (rule 4): the button's ::after is stretched over the row, and its ring is the row's. */}
        <button type="button" onClick={() => onOpen(doc)} aria-label={tt("documents.open", { title: doc.title })}
          className={cn(
            "min-w-0 flex-1 text-left outline-none",
            "after:absolute after:inset-0 after:rounded-[var(--radius-ctl)] after:content-['']",
            "focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50",
          )}>
          <span lang="" className="block truncate text-sm font-medium text-card-foreground">{doc.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
            <span aria-hidden="true">·</span>
            <ScanStatus scan={rowScan(doc, now)} locale={locale} />
            <span>{sourceLine(doc, today, locale)}</span>
            <ExpiryLine expiresOn={doc.expiresOn} today={today} locale={locale} />
            {doc.versions.length > 1 ? (
              <span data-document-version className="tabular-nums">{tt("documents.version", { n: doc.versions.length })}</span>
            ) : null}
            {doc.ownersOnly ? (
              <span data-owners-only className="inline-flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}
              </span>
            ) : null}
            {progress ? <span data-version-progress aria-live="polite" className="tabular-nums">{progress}</span> : null}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className={cn("relative z-10", control)}
              aria-label={tt("documents.menu", { title: doc.title })}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {rowMenuItems(doc, canManage).map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => choose(item)}>{tt(item.labelKey)}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing ? (
        <dl data-document-edit className="relative z-10 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1 px-1 pb-2 text-sm">
          <Line label={tt("documents.field.title")}>
            <InlineField key={`title:${doc.title}`} label={tt("documents.field.title")} value={doc.title}
              rule={{ kind: "text", max: DOCUMENT_TITLE_MAX, required: true }} locale={locale}
              save={save("title")} undoWith={undoWith} />
          </Line>
          <Line label={tt("documents.field.category")}>
            <InlineField key={`category:${doc.category}`} label={tt("documents.field.category")} value={doc.category}
              options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: tt(`documents.category.${c}` as MessageKey) }))}
              locale={locale} save={save("category")} undoWith={undoWith} />
          </Line>
          <Line label={tt("documents.field.expires")}>
            <InlineField key={`expires:${doc.expiresOn ?? ""}`} label={tt("documents.field.expires")} value={doc.expiresOn}
              rule={{ kind: "date", required: false }} inputType="date" display="date" locale={locale}
              save={save("expires_on")} undoWith={undoWith} />
          </Line>
        </dl>
      ) : null}
    </li>
  );
}

/** Rule 7: rows shaped like the content (an icon, a title, a line of facts), never a spinner. */
function DocumentsSkeleton() {
  return (
    <div data-documents-skeleton aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn("flex items-start gap-2 px-1 py-2", rowLine)}>
          <Skeleton className="size-4 shrink-0 rounded-[var(--radius-ctl)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-4 rounded-[var(--radius-ctl)]", i === 1 ? "w-1/2" : "w-2/3")} />
            <Skeleton className="h-3 w-5/6 rounded-[var(--radius-ctl)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The card's body inside its RecordCard (spec 4.1): the count in the first row (the card's title is
 * a fixed string), then Upload, the card's ONE primary while the upload panel is closed (rule 8); while
 * it is open, the panel's own Upload is that primary and the header draws neither button. Take photo is
 * ghost and shows only on a coarse pointer or a narrow screen. "Ask the customer" (S-07 2b) is ghost too,
 * beside it, once the requests read is ready (its dialog needs the channels on offer). The open requests
 * sit after the file list and before the trash, and their read fails on its own (spec 6). Presentational:
 * the container holds state.
 */
export function DocumentsCardView(p: {
  accountId: string; load: DocumentsLoad; canManage: boolean; emptyText: string; locale: Locale; handlers: DocumentHandlers;
  onRetry: () => void; onFiles: (files: File[], source: "upload" | "camera") => void; onOpen: (doc: DocumentView) => void;
  panel: ReactNode | null;
  versionPhases: Readonly<Record<string, UploadPhase>>; onNewVersion: (doc: DocumentView) => void; onPurge: (doc: DocumentView) => void;
  requests: RequestsSlot;
}) {
  const tt = (key: MessageKey, params?: Params) => t(m, key, p.locale, params);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (source: "upload" | "camera") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length > 0) p.onFiles(files, source);
  };
  if (p.load.status === "loading") return <div data-documents-card><DocumentsSkeleton /></div>;
  if (p.load.status === "error") {
    return (
      // Announced, plain words and a ghost Retry: RecordCardError's look, inside the record card's own boundary.
      <div data-documents-card data-record-error role="alert" className="space-y-2 text-sm">
        <p className="text-muted-foreground">{tt("documents.loadFailed")}</p>
        <Button type="button" size="sm" variant="ghost" className={control} onClick={p.onRetry}>{tt("documents.retry")}</Button>
      </div>
    );
  }
  const { data } = p.load;
  const spaceText = spaceUsedText(data.space, p.locale);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  return (
    <div data-documents-card
      className={cn("space-y-2 rounded-[var(--radius-ctl)]", dragging && "ring-[3px] ring-ring/50")}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        const files = [...e.dataTransfer.files];
        if (files.length > 0) p.onFiles(files, "upload");
      }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground tabular-nums">
            {plural(m, "documents.count", data.live.length, p.locale, { count: data.live.length })}
          </span>
          {spaceText ? <span data-space-used className="text-xs text-muted-foreground tabular-nums">{spaceText}</span> : null}
        </div>
        {p.panel ? null : (
          <div className="flex flex-wrap gap-2">
            {p.requests.load.kind === "ready" ? (
              <Button type="button" variant="ghost" data-ask-customer className={control} onClick={p.requests.onAsk}>
                {tt("documents.request.open")}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" data-take-photo
              className={cn("hidden max-md:inline-flex pointer-coarse:inline-flex", control)}
              onClick={() => cameraRef.current?.click()}>{tt("documents.takePhoto")}</Button>
            <Button type="button" className={control} onClick={() => uploadRef.current?.click()}>{tt("documents.upload")}</Button>
          </div>
        )}
        <input ref={uploadRef} type="file" multiple accept={ACCEPT} hidden onChange={pick("upload")} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick("camera")} />
      </div>
      {p.panel}
      {data.live.length === 0 ? (
        p.panel ? null : <p className="text-sm text-muted-foreground">{p.emptyText}</p>
      ) : (
        <ul>
          {data.live.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} today={data.today} now={data.now} canManage={p.canManage} locale={p.locale} handlers={p.handlers}
              phase={p.versionPhases[doc.id] ?? null} onOpen={p.onOpen} onNewVersion={p.onNewVersion} />
          ))}
        </ul>
      )}
      {data.capped ? <p className="text-xs text-muted-foreground">{tt("documents.capped")}</p> : null}
      <DocumentRequestsList locale={p.locale} load={p.requests.load} onRetry={p.requests.onRetry}
        onCopy={p.requests.onCopy} onRevoke={p.requests.onRevoke} />
      {data.trashed.length > 0 ? (
        <details data-documents-trash className="text-sm">
          <summary className={cn("cursor-pointer rounded-[var(--radius-ctl)] py-1 text-xs text-muted-foreground", focusRing)}>
            {tt("documents.trashList", { count: data.trashed.length })}
          </summary>
          <ul className="mt-1">
            {data.trashed.map((doc) => (
              <li key={doc.id} data-document-trashed={doc.id} className={cn("flex items-center gap-2 py-1.5", rowLine)}>
                <span className="min-w-0 flex-1">
                  <span lang="" className="block truncate text-card-foreground">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">{purgeText(purgeDaysLeft(doc.deletedAt ?? data.now, data.now), p.locale)}</span>
                </span>
                {/* Review m1: a Delete forever that began and did not finish can never be restored (deviation 4): the state, as a dot and a word (rule 3). */}
                {doc.purging ? (
                  <span data-document-purging className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--warn)]" />{tt("documents.status.purging")}
                  </span>
                ) : (
                  <Button type="button" variant="ghost" size="sm" data-document-restore className={control}
                    onClick={() => void p.handlers.restore(doc)}>{tt("documents.restore")}</Button>
                )}
                {/* An Owner or the agency only (owner ruling R1; the server refuses anyone else too); it also finishes a purge that stopped part-way. */}
                {p.canManage ? (
                  <Button type="button" variant="ghost" size="sm" data-document-purge className={control}
                    onClick={() => p.onPurge(doc)}>{tt("documents.deleteForever")}</Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * I1: the re-read timer's own key, so the effect re-arms on EVERY settle even when `nextPollMs` repeats
 * the exact same number across successive reads (its value is a constant for as long as the same
 * version stays pending, and a failed read answers the same number again too — an effect keyed on
 * `pollMs` alone would schedule its ONE timer and never another). `reads` bumps on every settle in
 * `DocumentsCard`, success or error, so the key always changes while polling should continue, and
 * answers null (no timer) the moment nothing is left to poll.
 */
export function pollTimerKey(pollMs: number | null, reads: number): string | null {
  return pollMs === null ? null : `${pollMs}:${reads}`;
}

let panelSeq = 0;

/**
 * The container (the Properties card's shape, places-card.tsx): reads its own route, holds the upload
 * panel's state and the viewer. A re-read after a change that fails keeps what the card already shows;
 * only a first read, or a Retry (which goes back to the skeleton first), shows the error state.
 */
export function DocumentsCard({ accountId, record, canManage, emptyText, name = "" }: {
  /** `name`: who "Ask the customer" asks, for its dialog's title; with none, the title is the action's own words. */
  accountId: string; record: DocRecord; canManage: boolean; emptyText: string; name?: string;
}) {
  const locale = useLocale();
  // A plain string, stable by value even when the caller hands `record` a fresh object each render.
  const route = documentsRouteFor(accountId, record);
  const [state, setState] = useState<{ route: string; load: DocumentsLoad }>({ route: "", load: { status: "loading" } });
  const [nonce, setNonce] = useState(0);
  // I1: bumped by `settle` on EVERY outcome, success or error, so the poll timer below can tell two
  // reads apart even when nextPollMs answers the exact same number both times (its own value is a
  // constant while the same version stays pending) — see pollTimerKey.
  const [reads, setReads] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  // Delete forever holds its file by id (plan review): the dialog shows the file as the card last read it.
  const [purgeId, setPurgeId] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    const settle = (load: DocumentsLoad) => {
      if (stale) return;
      setState((s) => (load.status === "error" && s.route === route && s.load.status === "ready" ? s : { route, load }));
      // A file that left the list is forgotten, so an Undo or a Restore later never reopens the viewer by itself.
      setOpenId((id) => keepOpen(id, load));
      setPurgeId((id) => keepPurge(id, load));
      setReads((r) => r + 1);
    };
    fetch(route, { cache: "no-store" })
      .then(documentsLoadFrom)
      .then(settle, () => settle({ status: "error" }));
    return () => { stale = true; };
  }, [route, nonce]);
  const load: DocumentsLoad = state.route === route ? state.load : { status: "loading" };
  const reload = () => setNonce((n) => n + 1);

  // Spec 3.4/3.5: while any file is Checking, re-read on a timer, fast for its first two minutes, then
  // slower; the timer's callback bumps the read, never the effect body (react-hooks/set-state-in-effect).
  // I1: keyed on pollTimerKey(pollMs, reads), not pollMs alone — pollMs is a constant while the same
  // version stays pending (or stays unreadable: a failed read answers the same number too), so an
  // effect keyed on pollMs alone fires ONCE and never again; reads changes every settle and re-arms it.
  const pollMs = nextPollMs(load);
  const pollKey = pollTimerKey(pollMs, reads);
  useEffect(() => {
    if (pollMs === null) return;
    const timer = setTimeout(() => setNonce((n) => n + 1), pollMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollKey already folds pollMs and reads together (see pollTimerKey); pollMs alone would under-trigger (I1).
  }, [pollKey]);

  // S-07 2b: the open requests are a second read of their own, apart from the files' (spec 6: its failure
  // never touches the files, and the files' never touches it). A failed re-read keeps what the list shows;
  // only a first read, or its Retry, shows its error. No timer: it re-reads when this card changes a request.
  const requestsRoute = documentRequestsRouteFor(accountId, record);
  const [requestsState, setRequestsState] = useState<{ route: string; load: DocumentRequestsLoad }>({ route: "", load: { kind: "loading" } });
  const [requestsNonce, setRequestsNonce] = useState(0);
  useEffect(() => {
    let stale = false;
    const settle = (next: DocumentRequestsLoad) => {
      if (stale) return;
      setRequestsState((s) => (next.kind === "error" && s.route === requestsRoute && s.load.kind === "ready" ? s : { route: requestsRoute, load: next }));
    };
    fetch(requestsRoute, { cache: "no-store" })
      .then(documentRequestsLoadFrom)
      .then(settle, () => settle({ kind: "error" }));
    return () => { stale = true; };
  }, [requestsRoute, requestsNonce]);
  const requestsLoad: DocumentRequestsLoad = requestsState.route === requestsRoute ? requestsState.load : { kind: "loading" };
  const reloadRequests = () => setRequestsNonce((n) => n + 1);

  // One Set for the card's whole life: the in-flight lock must outlast a re-render.
  const [inFlight] = useState(() => new Set<string>());
  const handlers = documentHandlers({ accountId, locale, reload, reloadRequests, inFlight });

  // "Ask the customer": the dialog closes once a request exists, and stays open with the refusal's words otherwise.
  const [askOpen, setAskOpen] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<MessageKey | null>(null);
  const openAsk = () => { setAskError(null); setAskOpen(true); };
  const onAskSubmit = (items: DocumentRequestItem[], channel: RequestChannel) => {
    setAskBusy(true);
    setAskError(null);
    void handlers.askCustomer({ record, items, channel })
      .then((error) => { if (error) setAskError(error); else setAskOpen(false); }, () => setAskError("documents.request.failed"))
      .finally(() => setAskBusy(false));
  };

  const [files, setFiles] = useState<PanelFile[]>([]);
  const [source, setSource] = useState<"upload" | "camera">("upload");
  const [ownersOnly, setOwnersOnly] = useState(false);
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  // ONE lock for every upload write on the card (exclusive): held for a whole batch and for each Retry.
  const [lock] = useState(() => ({ held: false }));

  const closePanel = () => { setFiles([]); setOwnersOnly(false); setExpiresOn(""); };
  const onFiles = (chosen: File[], from: "upload" | "camera") => {
    // A batch on its way is never replaced by a second drop; the person is told to wait.
    const refused = dropRefusal(lock.held, chosen.length);
    if (refused) { toast.error(t(m, refused, locale)); return; }
    // A new batch starts with the batch choices cleared.
    setOwnersOnly(false);
    setExpiresOn("");
    setSource(from);
    setFiles(chosen.map((file) => {
      const type = typeForFile(file.name, file.type);
      const category: DocumentCategory = type ? defaultCategory(type) : "other";
      return { key: `f${++panelSeq}`, file, title: titleFromFileName(file.name) ?? t(m, "documents.untitled", locale), category, phase: null };
    }));
  };
  const setPhase = (key: string, phase: PanelFile["phase"]) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, phase } : f)));
  const batch = (): UploadBatch => ({ record, ownersOnly: canManage && ownersOnly, expiresOn: expiresOn || null, source });
  const runOne = async (f: PanelFile): Promise<boolean> => {
    const end = await uploadOne(accountId, { file: f.file, title: f.title, category: f.category }, batch(), browserDeps(), (ph) => setPhase(f.key, ph));
    setPhase(f.key, end);
    return end.kind === "done";
  };
  /** Under the lock: `busy` disables the panel's Upload, Retry, Remove and Cancel for as long as it is held. */
  const locked = (run: () => Promise<void>) => exclusive(lock, async () => {
    setBusy(true);
    try { await run(); } finally { setBusy(false); }
  });
  /** Files that finished leave the panel and join the list; failed ones stay with their reason and Retry. The panel closes when none is left. */
  const settle = (done: Set<string>) => {
    if (done.size === 0) return;
    reload();
    setFiles((fs) => fs.filter((f) => !done.has(f.key)));
  };
  const onUpload = () => locked(async () => {
    const done = new Set<string>();
    for (const f of files) if (await runOne(f)) done.add(f.key);
    settle(done);
  });
  const onRetryFile = (key: string) => locked(async () => {
    const f = files.find((x) => x.key === key);
    if (f && (await runOne(f))) settle(new Set([key]));
  });

  // "Upload new version" (spec 4.1): the row menu opens ONE hidden single-file input; the chosen file goes
  // up under the card's one upload lock (a batch, a Retry and a new version never overlap), its progress on
  // its own row, and the card says how it ended.
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<DocumentView | null>(null);
  const [versionPhases, setVersionPhases] = useState<Record<string, UploadPhase>>({});
  const setVersionPhase = (id: string, phase: UploadPhase | null) => setVersionPhases((ps) => {
    const next = { ...ps };
    if (phase) next[id] = phase; else delete next[id];
    return next;
  });
  const onNewVersion = (doc: DocumentView) => {
    const refused = dropRefusal(lock.held, 1);
    if (refused) { toast.error(t(m, refused, locale)); return; }
    versionTarget.current = doc;
    versionInput.current?.click();
  };
  const onVersionFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const doc = versionTarget.current;
    versionTarget.current = null;
    if (!file || !doc) return;
    // Review M10: a batch or a Retry may have taken the lock between the menu click and the file choice; say so.
    void locked(async () => {
      const end = await uploadVersion(accountId, doc.id, file, browserVersionDeps(), (ph) => setVersionPhase(doc.id, ph));
      setVersionPhase(doc.id, null);
      if (end.kind === "done") reload();
      const said = versionToast(end, doc.title, locale);
      if (said?.ok) toast.success(said.text);
      else if (said) toast.error(said.text);
    }).then((ran) => { if (ran === null) toast.error(t(m, "documents.error.busy", locale)); });
  };

  const panel = files.length > 0 ? (
    <DocumentUploadPanel files={files} ownersOnly={ownersOnly} expiresOn={expiresOn} canChooseOwnersOnly={canManage} busy={busy} locale={locale}
      onCategory={(k, c) => setFiles((fs) => fs.map((f) => (f.key === k ? { ...f, category: c } : f)))}
      onRemove={(k) => setFiles((fs) => fs.filter((f) => f.key !== k))}
      onOwnersOnly={setOwnersOnly} onExpires={setExpiresOn} onUpload={() => void onUpload()} onRetry={(k) => void onRetryFile(k)}
      onCancel={closePanel} />
  ) : null;

  // The viewer shows the row as the card last read it: a rename shows at once, and a file that left the list closes it.
  const ready = load.status === "ready" ? load.data : null;
  const open = ready && openId ? ready.live.find((d) => d.id === openId) ?? null : null;
  const openExpiry = open && ready ? expiryView(open.expiresOn, ready.today) : null;
  const purgeTarget = ready && purgeId ? ready.trashed.find((d) => d.id === purgeId) ?? null : null;
  return (
    <>
      <DocumentsCardView accountId={accountId} load={load} canManage={canManage} emptyText={emptyText} locale={locale} handlers={handlers}
        onRetry={() => { setState({ route: "", load: { status: "loading" } }); reload(); }}
        onFiles={onFiles} onOpen={(d) => setOpenId(d.id)} panel={panel}
        versionPhases={versionPhases} onNewVersion={onNewVersion} onPurge={(d) => setPurgeId(d.id)}
        requests={{
          load: requestsLoad, onAsk: openAsk,
          onRetry: () => { setRequestsState({ route: "", load: { kind: "loading" } }); reloadRequests(); },
          onCopy: (id) => void handlers.copyRequestLink(id), onRevoke: (id) => void handlers.revokeRequest(id),
        }} />
      <DocumentRequestDialog open={askOpen} locale={locale} name={name}
        channels={requestsLoad.kind === "ready" ? requestsLoad.data.channels : { text: false, email: false }}
        busy={askBusy} error={askError} onSubmit={onAskSubmit} onClose={() => setAskOpen(false)} />
      <input ref={versionInput} type="file" accept={ACCEPT} hidden data-version-input onChange={onVersionFile} />
      <DocumentViewer accountId={accountId} doc={open} locale={locale} onClose={() => setOpenId(null)}
        onDownload={(d) => void handlers.download(d)}
        onDownloadVersion={(d, versionId) => void handlers.download(d, versionId)}
        versionWhen={(day) => (ready ? addedWhen(day, ready.today, locale) : "")}
        header={{ source: open && ready ? sourceLine(open, ready.today, locale) : "", expiry: openExpiry ? expiryText(openExpiry, locale) : null }} />
      <DocumentPurgeDialog doc={purgeTarget} locale={locale} onClose={() => setPurgeId(null)} onConfirm={(d, typed) => handlers.purge(d, typed)} />
    </>
  );
}
