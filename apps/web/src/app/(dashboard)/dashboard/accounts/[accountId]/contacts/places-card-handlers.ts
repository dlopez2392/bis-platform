import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import {
  removePlaceAction, undoRemovePlaceAction, setPlaceArchivedAction, setPlaceOwnerAction, removeEquipmentAction, undoRemoveEquipmentAction,
  type PlaceSubjectArg,
} from "./places-actions";

/**
 * What the Properties card does when a property or a unit is removed, put back, added or replaced
 * (spec §7, rule 6: everything runs at once, every toast offers Undo, nothing asks "Are you sure?").
 * Kept out of the component so it is tested without a DOM (the Related people card's shape).
 *
 * Every answer from an action is a messages.ts key, translated here in the reader's language. A
 * rejected action (a stale tab after a redeploy) is a plain failure, never a silent one; a rejected
 * Undo is "Couldn't put it back.". `inFlight` (one Set the card holds across renders) ignores a
 * second click on a row whose write has not settled, so two clicks never race two writes and two
 * Undo payloads for the same row.
 */
export type PlaceHandlers = {
  removePlace(id: string, title: string): Promise<void>;
  putBack(id: string, title: string): Promise<void>;
  removeUnit(id: string, name: string): Promise<void>;
  /** A dialog added a property: the toast, and its Undo (which deletes it, spec §7). */
  placeAdded(id: string, title: string): void;
  /** A dialog added a unit: the toast, and its Undo (which deletes it). */
  unitAdded(id: string, name: string): void;
  /** A dialog replaced a unit with `newId`: the toast, and its Undo (which deletes the new unit). */
  unitReplaced(newId: string): void;
  /** The owner select saved (Owner and Staff): "{place} now belongs to {owner}.", and its Undo sets `priorOwner` back (spec §7). */
  ownerChanged(placeId: string, title: string, owner: string, priorOwner: string): void;
  /** Something on the card changed: re-read it. */
  changed(): void;
};

type Answer = { ok: true } | { ok: false; error: string; params?: Record<string, string | number> };
const failed = { ok: false as const, error: "places.error.failed" };
const undoFailed = { ok: false as const, error: "places.error.undoFailed" };

export function placeHandlers({ accountId, contactId, locale, reload, inFlight = new Set<string>() }: {
  accountId: string; contactId: PlaceSubjectArg; locale: Locale; reload: () => void; inFlight?: Set<string>;
}): PlaceHandlers {
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const say = (a: { error: string; params?: Record<string, string | number> }) => toast.error(tt(a.error, a.params));
  const undoLabel = tt("common.undo");

  /** One write per row at a time; the lock is released however the write ends. */
  async function once<R>(id: string, run: () => Promise<R>): Promise<R | null> {
    if (inFlight.has(id)) return null;
    inFlight.add(id);
    try { return await run(); } finally { inFlight.delete(id); }
  }

  /** A success toast whose Undo runs `undo` once per row at a time (a double click undoes once), re-reads on success and says why on failure. */
  function offer(message: string, row: string, undo: () => Promise<Answer>) {
    toast.success(message, { action: { label: undoLabel, onClick: () => {
      void once(row, () => undo().catch(() => undoFailed)).then((u) => { if (!u) return; if (u.ok) reload(); else say(u); });
    } } });
  }

  return {
    async removePlace(id, title) {
      const r = await once(id, () => removePlaceAction(accountId, contactId, id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      // The Undo the action answered, as it answered it: a deleted property comes back with the
      // same id; an archived one has its archive cleared (spec C5, §7).
      offer(tt(r.undo.mode === "deleted" ? "places.removed" : "places.archived", { place: title }), id,
        () => undoRemovePlaceAction(accountId, contactId, r.undo));
    },
    async putBack(id, title) {
      const r = await once(id, () => setPlaceArchivedAction(accountId, contactId, id, false).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      offer(tt("places.putBackDone", { place: title }), id, () => setPlaceArchivedAction(accountId, contactId, id, true));
    },
    async removeUnit(id, name) {
      const r = await once(id, () => removeEquipmentAction(accountId, contactId, id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      offer(tt("equipment.removed", { name }), id, () => undoRemoveEquipmentAction(accountId, contactId, r.snapshot));
    },
    placeAdded(id, title) {
      reload();
      offer(tt("places.added", { place: title }), id, () => removePlaceAction(accountId, contactId, id));
    },
    unitAdded(id, name) {
      reload();
      offer(tt("equipment.added", { name }), id, () => removeEquipmentAction(accountId, contactId, id));
    },
    unitReplaced(newId) {
      reload();
      offer(tt("equipment.replaced"), newId, () => removeEquipmentAction(accountId, contactId, newId));
    },
    ownerChanged(placeId, title, owner, priorOwner) {
      reload();
      offer(tt("places.ownerChanged", { place: title, owner }), placeId, () => setPlaceOwnerAction(accountId, contactId, placeId, priorOwner));
    },
    changed: reload,
  };
}
