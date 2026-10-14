import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView } from "@/lib/documents/documents-load";
import {
  trashDocumentAction, restoreDocumentAction, setOwnersOnlyAction, undoOwnersOnlyAction, getDocumentUrlAction,
  updateDocumentFieldAction, undoDocumentFieldAction, purgeDocumentAction, type DocumentUndo,
} from "./documents-actions";

/**
 * What the Documents card does on trash, restore, Owners only and Download (spec 4.4, rule 6: at
 * once, every toast with an Undo, no "Are you sure?"). Each Undo is a compare-and-set on the server:
 * it changes nothing, and says so, when someone wrote after it. Kept out of the component so it is
 * tested without a DOM (places-card-handlers.ts's shape). Every answer from an action is a
 * messages.ts key, translated here in the reader's language; an action that throws (a stale tab after
 * a redeploy) is a plain failure, never a silent one. `inFlight` (one Set the card holds for its
 * whole life) ignores a second click on a row whose write has not settled. Inline edits and Delete
 * forever go through here too (PR 1a review M6), so the styleguide can inject handlers that never reach
 * a server action.
 */
export type FieldSave = { ok: true; undoPayload: DocumentUndo; shown: string } | { ok: false; error: string };
export type DocumentHandlers = {
  trash(doc: DocumentView): Promise<void>;
  restore(doc: DocumentView): Promise<void>;
  setOwnersOnly(doc: DocumentView, value: boolean): Promise<void>;
  /** The current version, or the named older one (spec 4.3). */
  download(doc: DocumentView, versionId?: string): Promise<void>;
  /** An inline edit: InlineField's own answer, the refusal already in the reader's words. */
  saveField(doc: DocumentView, field: DocumentUndo["field"], value: string): Promise<FieldSave>;
  undoField(payload: unknown): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Delete forever: true once the server answered, gone or refused (review I2: the dialog closes); false when nothing was sent. */
  purge(doc: DocumentView, typed: string): Promise<boolean>;
  /** Something on the card changed: re-read it. */
  changed(): void;
};

type Answer = { ok: true } | { ok: false; error: string; params?: Record<string, string | number> };
const failed = { ok: false as const, error: "documents.error.failed" };

export function documentHandlers({ accountId, locale, reload, inFlight = new Set<string>() }: {
  accountId: string; locale: Locale; reload: () => void; inFlight?: Set<string>;
}): DocumentHandlers {
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const say = (a: { error: string; params?: Record<string, string | number> }) => toast.error(tt(a.error, a.params));
  const words = (a: { error: string; params?: Record<string, string | number> }) => tt(a.error, a.params);

  /** One write per row at a time; the lock is released however the write ends. */
  async function once<R>(id: string, run: () => Promise<R>): Promise<R | null> {
    if (inFlight.has(id)) return null;
    inFlight.add(id);
    try { return await run(); } finally { inFlight.delete(id); }
  }

  /** A success toast whose Undo runs `undo` once per row at a time, re-reads on success and says why on failure. */
  function offer(message: string, row: string, undo: () => Promise<Answer>) {
    toast.success(message, { action: { label: tt("common.undo"), onClick: () => {
      void once(row, () => undo().catch(() => failed)).then((u) => { if (!u) return; if (u.ok) reload(); else say(u); });
    } } });
  }

  return {
    async trash(doc) {
      const r = await once(doc.id, () => trashDocumentAction(accountId, doc.id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      // The Undo restores against the instant THIS trash wrote, so a later trash by someone else is never undone.
      offer(tt("documents.trashed", { title: doc.title }), doc.id, () => restoreDocumentAction(accountId, doc.id, r.deletedAt));
    },
    async restore(doc) {
      const deletedAt = doc.deletedAt;
      if (!deletedAt) return;
      const r = await once(doc.id, () => restoreDocumentAction(accountId, doc.id, deletedAt).catch(() => failed));
      if (!r) return;
      if (!r.ok) {
        // Someone restored or re-trashed it first: this was not an Undo, so "nothing was undone" would mislead.
        say(r.error === "documents.undoChanged" ? failed : r);
        reload();
        return;
      }
      reload();
      offer(tt("documents.restored", { title: doc.title }), doc.id, async () => {
        const again = await trashDocumentAction(accountId, doc.id);
        return again.ok ? { ok: true } : again;
      });
    },
    async setOwnersOnly(doc, value) {
      const r = await once(doc.id, () => setOwnersOnlyAction(accountId, doc.id, value).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      offer(tt(value ? "documents.madeOwnersOnly" : "documents.madeTeam", { title: doc.title }), doc.id,
        () => undoOwnersOnlyAction(accountId, doc.id, r.prior, value));
    },
    async download(doc, versionId) {
      const r = await getDocumentUrlAction(accountId, versionId ?? doc.version.id, "download")
        .catch(() => ({ ok: false as const, error: "documents.error.open" }));
      if (!r.ok) { say(r); return; }
      window.location.assign(r.url);
    },
    async saveField(doc, field, value) {
      const r = await updateDocumentFieldAction(accountId, doc.id, field, value).catch(() => failed);
      if (!r.ok) return { ok: false, error: words(r) };
      reload();
      return { ok: true, undoPayload: r.undoPayload, shown: r.shown };
    },
    async undoField(payload) {
      const r = await undoDocumentFieldAction(accountId, payload).catch(() => failed);
      if (!r.ok) return { ok: false, error: words(r) };
      reload();
      return { ok: true };
    },
    async purge(doc, typed) {
      const r = await once(doc.id, () => purgeDocumentAction(accountId, doc.id, typed)
        .catch(() => ({ ok: false as const, error: "documents.error.purge" })));
      if (!r) return false;
      if (!r.ok) {
        // Review I2: every refusal re-reads and closes the dialog. The browser enables the button only on
        // the card's own title, so even a server mismatch means the file changed underneath (renamed,
        // restored, purged); the card must show the truth rather than keep a dialog about a stale file.
        say(r);
        reload();
        return true;
      }
      reload();
      // Gone for good: nothing to undo, so no Undo action (the typed name was the guard; rule 6).
      toast.success(tt("documents.purged", { title: doc.title }));
      return true;
    },
    changed: reload,
  };
}
