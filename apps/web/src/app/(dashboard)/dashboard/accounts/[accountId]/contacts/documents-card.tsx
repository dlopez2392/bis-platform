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
import { DOCUMENT_CATEGORIES, DOCUMENT_TITLE_MAX, type DocumentCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t, plural } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { documentsLoadFrom, type DocumentsLoad, type DocumentView } from "@/lib/documents/documents-load";
import { dayDiff, expiryView, expiryText, purgeDaysLeft, purgeText } from "@/lib/documents/expiry";
import { MAX_BATCH, defaultCategory, titleFromFileName, typeForFile } from "@/lib/documents/rules";
import { browserDeps, uploadOne, type UploadBatch } from "@/lib/documents/upload-client";
import { updateDocumentFieldAction, undoDocumentFieldAction, type DocumentUndo } from "./documents-actions";
import { documentHandlers, type DocumentHandlers } from "./documents-card-handlers";
import { DocumentUploadPanel, type PanelFile } from "./document-upload-panel";
import { DocumentViewer } from "./document-viewer";

export type { DocumentHandlers } from "./documents-card-handlers";

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

/** "Added by Ana · 3 days ago" / "Photo taken by you · today"; a person the reader cannot name is "Someone on the team". */
export function sourceLine(doc: DocumentView, today: string, locale: Locale): string {
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
 * The row menu (spec 4.1), as data: the component maps it one to one, and the test reads it (the menu's
 * content renders in a portal only while open). Owners only is the Owner's and the agency's.
 */
export type RowMenuItem = { id: "edit" | "ownersOnly" | "download" | "trash"; labelKey: MessageKey };
export function rowMenuItems(doc: DocumentView, canManage: boolean): RowMenuItem[] {
  const items: RowMenuItem[] = [{ id: "edit", labelKey: "documents.edit" }];
  if (canManage) items.push({ id: "ownersOnly", labelKey: doc.ownersOnly ? "documents.makeTeam" : "documents.makeOwnersOnly" });
  items.push({ id: "download", labelKey: "documents.download" }, { id: "trash", labelKey: "documents.trash" });
  return items;
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

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="break-words pt-1 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function DocumentRow({ accountId, doc, today, canManage, locale, handlers, onOpen }: {
  accountId: string; doc: DocumentView; today: string; canManage: boolean; locale: Locale;
  handlers: DocumentHandlers; onOpen: (d: DocumentView) => void;
}) {
  const tt = (key: MessageKey, params?: Params) => t(m, key, locale, params);
  const [editing, setEditing] = useState(false);
  // Every inline edit saves at once with an Undo (rule 6); the Undo is the server's own compare-and-set.
  const save = (field: DocumentUndo["field"]) => async (value: string) => {
    const r = await updateDocumentFieldAction(accountId, doc.id, field, value)
      .catch((): { ok: false; error: string; params?: Params } => ({ ok: false, error: "documents.error.failed" }));
    if (!r.ok) return { ok: false as const, error: tt(r.error as MessageKey, r.params) };
    handlers.changed();
    return { ok: true as const, undoPayload: r.undoPayload, shown: r.shown };
  };
  const undoWith = async (payload: unknown) => {
    const r = await undoDocumentFieldAction(accountId, payload)
      .catch((): { ok: false; error: string; params?: Params } => ({ ok: false, error: "documents.error.failed" }));
    if (!r.ok) return { ok: false as const, error: tt(r.error as MessageKey, r.params) };
    handlers.changed();
    return { ok: true as const };
  };
  const choose = (item: RowMenuItem) => {
    if (item.id === "edit") setEditing((e) => !e);
    else if (item.id === "ownersOnly") void handlers.setOwnersOnly(doc, !doc.ownersOnly);
    else if (item.id === "download") void handlers.download(doc);
    else void handlers.trash(doc);
  };
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
            <span>{sourceLine(doc, today, locale)}</span>
            <ExpiryLine expiresOn={doc.expiresOn} today={today} locale={locale} />
            {doc.ownersOnly ? (
              <span data-owners-only className="inline-flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}
              </span>
            ) : null}
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
 * ghost and shows only on a coarse pointer or a narrow screen. Presentational: the container holds state.
 */
export function DocumentsCardView(p: {
  accountId: string; load: DocumentsLoad; canManage: boolean; emptyText: string; locale: Locale; handlers: DocumentHandlers;
  onRetry: () => void; onFiles: (files: File[], source: "upload" | "camera") => void; onOpen: (doc: DocumentView) => void;
  panel: ReactNode | null;
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
        <span className="text-xs text-muted-foreground tabular-nums">
          {plural(m, "documents.count", data.live.length, p.locale, { count: data.live.length })}
        </span>
        {p.panel ? null : (
          <div className="flex flex-wrap gap-2">
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
            <DocumentRow key={doc.id} accountId={p.accountId} doc={doc} today={data.today} canManage={p.canManage}
              locale={p.locale} handlers={p.handlers} onOpen={p.onOpen} />
          ))}
        </ul>
      )}
      {data.capped ? <p className="text-xs text-muted-foreground">{tt("documents.capped")}</p> : null}
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
                <Button type="button" variant="ghost" size="sm" data-document-restore className={control}
                  onClick={() => void p.handlers.restore(doc)}>{tt("documents.restore")}</Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

let panelSeq = 0;

/**
 * The container (the Properties card's shape, places-card.tsx): reads its own route, holds the upload
 * panel's state and the viewer. A re-read after a change that fails keeps what the card already shows;
 * only a first read, or a Retry (which goes back to the skeleton first), shows the error state.
 */
export function DocumentsCard({ accountId, record, canManage, emptyText }: {
  accountId: string; record: DocRecord; canManage: boolean; emptyText: string;
}) {
  const locale = useLocale();
  // A plain string, stable by value even when the caller hands `record` a fresh object each render.
  const route = documentsRouteFor(accountId, record);
  const [state, setState] = useState<{ route: string; load: DocumentsLoad }>({ route: "", load: { status: "loading" } });
  const [nonce, setNonce] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    const settle = (load: DocumentsLoad) => {
      if (stale) return;
      setState((s) => (load.status === "error" && s.route === route && s.load.status === "ready" ? s : { route, load }));
      // A file that left the list is forgotten, so an Undo or a Restore later never reopens the viewer by itself.
      setOpenId((id) => keepOpen(id, load));
    };
    fetch(route, { cache: "no-store" })
      .then(documentsLoadFrom)
      .then(settle, () => settle({ status: "error" }));
    return () => { stale = true; };
  }, [route, nonce]);
  const load: DocumentsLoad = state.route === route ? state.load : { status: "loading" };
  const reload = () => setNonce((n) => n + 1);

  // One Set for the card's whole life: the in-flight lock must outlast a re-render.
  const [inFlight] = useState(() => new Set<string>());
  const handlers = documentHandlers({ accountId, locale, reload, inFlight });

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
  return (
    <>
      <DocumentsCardView accountId={accountId} load={load} canManage={canManage} emptyText={emptyText} locale={locale} handlers={handlers}
        onRetry={() => { setState({ route: "", load: { status: "loading" } }); reload(); }}
        onFiles={onFiles} onOpen={(d) => setOpenId(d.id)} panel={panel} />
      <DocumentViewer accountId={accountId} doc={open} locale={locale} onClose={() => setOpenId(null)}
        onDownload={(d) => void handlers.download(d)}
        header={{ source: open && ready ? sourceLine(open, ready.today, locale) : "", expiry: openExpiry ? expiryText(openExpiry, locale) : null }} />
    </>
  );
}
