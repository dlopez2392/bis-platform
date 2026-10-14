import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView } from "@/lib/documents/documents-load";
import {
  trashDocumentAction, restoreDocumentAction, setOwnersOnlyAction, undoOwnersOnlyAction, getDocumentUrlAction,
} from "./documents-actions";

/**
 * What the Documents card does on trash, restore, Owners only and Download (spec 4.4, rule 6: at
 * once, every toast with an Undo, no "Are you sure?"). Each Undo is a compare-and-set on the server:
 * it changes nothing, and says so, when someone wrote after it. Kept out of the component so it is
 * tested without a DOM (places-card-handlers.ts's shape). Every answer from an action is a
 * messages.ts key, translated here in the reader's language; an action that throws (a stale tab after
 * a redeploy) is a plain failure, never a silent one. `inFlight` (one Set the card holds for its
 * whole life) ignores a second click on a row whose write has not settled.
 */
export type DocumentHandlers = {
  trash(doc: DocumentView): Promise<void>;
  restore(doc: DocumentView): Promise<void>;
  setOwnersOnly(doc: DocumentView, value: boolean): Promise<void>;
  download(doc: DocumentView): Promise<void>;
  /** Something on the card changed (an inline edit or its Undo): re-read it. */
  changed(): void;
};

type Answer = { ok: true } | { ok: false; error: string; params?: Record<string, string | number> };
const failed = { ok: false as const, error: "documents.error.failed" };

export function documentHandlers({ accountId, locale, reload, inFlight = new Set<string>() }: {
  accountId: string; locale: Locale; reload: () => void; inFlight?: Set<string>;
}): DocumentHandlers {
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const say = (a: { error: string; params?: Record<string, string | number> }) => toast.error(tt(a.error, a.params));

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
    async download(doc) {
      const r = await getDocumentUrlAction(accountId, doc.version.id, "download")
        .catch(() => ({ ok: false as const, error: "documents.error.open" }));
      if (!r.ok) { say(r); return; }
      window.location.assign(r.url);
    },
    changed: reload,
  };
}
