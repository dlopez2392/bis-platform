import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView } from "@/lib/documents/documents-load";
import type { DocumentRequestItem } from "@bis/db/document-rules";
import {
  trashDocumentAction, restoreDocumentAction, setOwnersOnlyAction, undoOwnersOnlyAction, getDocumentUrlAction,
  updateDocumentFieldAction, undoDocumentFieldAction, purgeDocumentAction, type DocumentUndo,
} from "./documents-actions";
import {
  createDocumentRequestAction, documentRequestLinkAction, revokeDocumentRequestAction, undoRevokeDocumentRequestAction,
} from "./document-requests-actions";
import { createDocumentShareAction, stopSharingAction, undoStopSharingAction } from "./document-shares-actions";

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
  /**
   * "Ask the customer" (S-07 2b, spec 4.2): creates the request and says how it went (sent, held until
   * after quiet hours, not sent and why, or the link copied). Answers null once a request exists, or the
   * refusal's key for the dialog to show (nothing was created).
   */
  askCustomer(input: { record: { kind: "contact" | "group"; id: string }; items: DocumentRequestItem[]; channel: "text" | "email" | "link" }): Promise<MessageKey | null>;
  /** Mints an open request's link again and copies it. */
  copyRequestLink(id: string): Promise<void>;
  /** At once, with an Undo (rule 6). */
  revokeRequest(id: string): Promise<void>;
  /** S-07 3b: makes a link to the file's current clean version and copies it. */
  copyShareLink(doc: DocumentView): Promise<void>;
  /** At once, with an Undo (rule 6). */
  stopSharing(doc: DocumentView): Promise<void>;
};

type Answer = { ok: true } | { ok: false; error: string; params?: Record<string, string | number> };
const failed = { ok: false as const, error: "documents.error.failed" };

export function documentHandlers({ accountId, locale, reload, reloadRequests, inFlight = new Set<string>() }: {
  /**
   * `reloadRequests` re-reads the card's open requests, which load apart from its files (spec 6). Required
   * (review I1): a default no-op let the card drop it with no test and no compiler noticing.
   */
  accountId: string; locale: Locale; reload: () => void; reloadRequests: () => void; inFlight?: Set<string>;
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

  /** A success toast whose Undo runs `undo` once per row at a time, re-reads (`after`) on success and says why on failure. */
  function offer(message: string, row: string, undo: () => Promise<Answer>, after: () => void = reload) {
    toast.success(message, { action: { label: tt("common.undo"), onClick: () => {
      void once(row, () => undo().catch(() => failed)).then((u) => { if (!u) return; if (u.ok) after(); else say(u); });
    } } });
  }

  /**
   * billing-card.tsx's copyLink: with no clipboard (a non-secure origin) or a refused one, the URL itself
   * goes in a toast that stays, so it can be copied by hand.
   */
  async function copyLink(url: string, copiedKey: MessageKey = "documents.request.linkCopied"): Promise<void> {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    try {
      if (!clipboard) throw new Error("no clipboard");
      await clipboard.writeText(url);
      toast.success(tt(copiedKey));
    } catch {
      toast.error(tt("documents.request.copyFailed"), { description: url, duration: Infinity, closeButton: true });
    }
  }

  /**
   * "8:00 AM" in the zone the answer names (the account's, or UTC when the ledger could not say). A zone
   * this browser cannot name (review M5) falls back to the browser's own clock, the account's time with no
   * zone label: the request exists by now, so the toast must still say it was saved, never throw.
   */
  const heldTime = (until: string, zone: string) => {
    const opts = { hour: "numeric", minute: "2-digit" } as const;
    const tag = locale === "es" ? "es-US" : "en-US";
    try {
      return new Intl.DateTimeFormat(tag, { ...opts, timeZone: zone }).format(new Date(until));
    } catch {
      return new Intl.DateTimeFormat(tag, opts).format(new Date(until));
    }
  };
  /** A request's row in the one-write-at-a-time lock, apart from any file's id. */
  const requestRow = (id: string) => `request:${id}`;
  /** A share write's row in the one-write-at-a-time lock, apart from the file's own id (trash, Owners only, …). */
  const shareRow = (id: string) => `share:${id}`;

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
    async askCustomer({ record, items, channel }) {
      // Review M5: an action that threw or never answered (a stale tab, a lost response) may still have created
      // the request, so it is never "Couldn't create the request" (that invites a duplicate send): the page may
      // be out of date, the dialog closes (null), and the re-read list shows whether it exists.
      const r = await createDocumentRequestAction(accountId, { record, items, channel }).catch(() => null);
      // Every answer re-reads the requests once: a new one is listed, and a refusal brings the channels up to date.
      reloadRequests();
      if (!r) { toast.error(tt("common.actionCrashed")); return null; }
      if (!r.ok) return r.error as MessageKey;
      const d = r.delivery;
      if (d.kind === "link") await copyLink(r.url);
      else if (d.kind === "sent") toast.success(tt(channel === "email" ? "documents.request.sentEmail" : "documents.request.sentText"));
      else if (d.kind === "held") toast.success(tt("documents.request.held", { time: heldTime(d.until, d.zone) }));
      // The request stands either way; the card's list offers its Copy link.
      else toast.error(tt("documents.request.notSent", { reason: tt(d.kind === "blocked" ? d.reason : "documents.request.reason.failed") }));
      return null;
    },
    async copyRequestLink(id) {
      const r = await once(requestRow(id), () => documentRequestLinkAction(accountId, id).catch(() => failed));
      if (!r) return;
      // Closed meanwhile (answered, expired, revoked elsewhere): say so and show the list as it is now.
      if (!r.ok) { say(r); reloadRequests(); return; }
      await copyLink(r.url);
    },
    async revokeRequest(id) {
      const r = await once(requestRow(id), () => revokeDocumentRequestAction(accountId, id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); reloadRequests(); return; }
      reloadRequests();
      // The Undo restores against the instant THIS revoke wrote, so a later revoke by someone else is never undone.
      offer(tt("documents.requests.revoked"), requestRow(id), () => undoRevokeDocumentRequestAction(accountId, id, r.revokedAt), reloadRequests);
    },
    async copyShareLink(doc) {
      const r = await once(shareRow(doc.id), () => createDocumentShareAction(accountId, doc.id).catch(() => ({ ok: false as const, error: "documents.share.failed" })));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      await copyLink(r.url, "documents.share.copied");
      reload();
    },
    async stopSharing(doc) {
      const r = await once(shareRow(doc.id), () => stopSharingAction(accountId, doc.id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); reload(); return; }
      reload();
      // The Undo puts back exactly the links THIS stop wrote, at its instant (plan deviation 3), with the
      // Owners-only value this stop's own read saw (undoStopSharingAction's fifth argument).
      offer(tt("documents.share.stopped", { title: doc.title }), shareRow(doc.id),
        () => undoStopSharingAction(accountId, doc.id, r.ids, r.revokedAt, r.ownersOnly));
    },
  };
}
