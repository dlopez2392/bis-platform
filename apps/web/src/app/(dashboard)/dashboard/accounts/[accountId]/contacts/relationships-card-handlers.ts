import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { personName } from "@/lib/contacts/relationship-labels";
import type { RelationshipView } from "@/lib/contacts/relationship-view";
import type { RelationshipsLoad } from "@/lib/contacts/relationships-load";
import {
  setRelationshipAction, undoSetRelationshipAction, removeRelationshipAction, undoRemoveRelationshipAction,
} from "./relationship-actions";

/** The card's state: the load, paired with the contact it was read for (the drawer's own pattern). */
export type CardState = { contactId: string; rel: RelationshipsLoad };

/** A server action that rejects (a stale tab after a redeploy) is a plain failure, never a silent one. */
const failed = { ok: false as const, error: "relationships.error.failed" as const };

/**
 * What the Related people card does when a chip is changed, removed or undone (spec §7, rule 6),
 * kept out of the component so it is tested without a DOM. Hardened by the final review (item 9):
 * - every state write checks the card still shows the contact it was asked for, so an answer that
 *   lands after the drawer moved to another customer never writes onto their card;
 * - a toggle or a word-form change on a relationship already being written is ignored until that
 *   write settles (`inFlight`, one Set held by the card across renders), so two quick clicks never
 *   race two writes and two Undo payloads for the same row.
 */
export function relationshipHandlers({ accountId, contactId, locale, setState, inFlight }: {
  accountId: string; contactId: string; locale: Locale;
  setState: (u: (s: CardState) => CardState) => void;
  inFlight: Set<string>;
}) {
  const replace = (view: RelationshipView) => setState((s) => s.contactId !== contactId || s.rel.status !== "ready" ? s
    : { ...s, rel: { ...s.rel, views: s.rel.views.some((v) => v.id === view.id) ? s.rel.views.map((v) => (v.id === view.id ? view : v)) : [...s.rel.views, view] } });
  const drop = (id: string) => setState((s) => s.contactId !== contactId || s.rel.status !== "ready" ? s : { ...s, rel: { ...s.rel, views: s.rel.views.filter((v) => v.id !== id) } });
  const say = (key: MessageKey) => toast.error(t(m, key, locale));
  const undoLabel = t(m, "relationships.undo", locale);

  const change = async (view: RelationshipView, patch: Record<string, unknown>) => {
    if (inFlight.has(view.id)) return;
    inFlight.add(view.id);
    const r = await setRelationshipAction(accountId, contactId, view.id, patch).catch(() => failed)
      .finally(() => inFlight.delete(view.id));
    if (!r.ok) { say(r.error); return; }
    replace(r.view);
    toast.success(t(m, "relationships.saved", locale), { action: { label: undoLabel, onClick: () => {
      void undoSetRelationshipAction(accountId, contactId, view.id, r.undo).catch(() => failed)
        .then((u) => (u.ok ? replace(u.view) : say(u.error)));
    } } });
  };

  const remove = async (view: RelationshipView) => {
    const r = await removeRelationshipAction(accountId, view.id).catch(() => failed);
    if (!r.ok) { say(r.error); return; }
    drop(view.id);
    const name = personName(view.person, t(m, "relationships.noName", locale));
    toast.success(t(m, "relationships.removed", locale, { name }), { action: { label: undoLabel, onClick: () => {
      void undoRemoveRelationshipAction(accountId, contactId, r.snapshot).catch(() => failed)
        .then((u) => (u.ok ? replace(u.view) : say(u.error)));
    } } });
  };

  return { replace, drop, change, remove };
}
