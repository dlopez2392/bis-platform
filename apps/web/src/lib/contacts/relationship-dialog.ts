import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { RelationshipKey } from "@bis/db/relationship-keys";
import { chipText } from "./relationship-labels";
import type { RelationshipView } from "./relationship-view";

/**
 * The add dialog's decisions that are not layout, kept pure so they are tested without a DOM
 * (apps/web has no DOM renderer). Client-safe.
 */
export type DialogOther =
  | { kind: "existing"; contactId: string }
  | { kind: "new"; firstName: string; lastName: string; phone: string };

/**
 * Who the dialog sends as the other person. Once the server has created a "New person" and the
 * relationship still failed, it answered their id (Task 4 review, finding 3): the retry relates
 * that contact instead of creating a second one.
 */
export function otherForSubmit(i: {
  mode: "find" | "new";
  picked: { id: string } | null;
  fresh: { firstName: string; lastName: string; phone: string };
  createdId: string | null;
}): DialogOther | null {
  if (i.mode === "new") return i.createdId ? { kind: "existing", contactId: i.createdId } : { kind: "new", ...i.fresh };
  return i.picked ? { kind: "existing", contactId: i.picked.id } : null;
}

export type Flag = "canPickUp" | "isEmergency";
/** The two labels a flag on any row can already say ("B is A's emergency contact"). */
const FLAG_OF_LABEL: Partial<Record<RelationshipKey, Flag>> = { emergency_contact: "isEmergency", authorized_pickup: "canPickUp" };

export type FlagHint = { view: RelationshipView; flag: Flag; on: boolean };

/**
 * "Emergency contact" or "Authorized pickup" for someone who already has a row with this customer:
 * that row's flag says the same thing, so the dialog points at it instead of silently making a
 * second row (Task 4 review, finding 5). The database still allows the second row (R7); this only
 * makes it a choice the reader sees. The flag on a view is the NAMED person's, which is the other
 * person here, so it means exactly what the picked label means.
 */
export function flagHintFor(views: readonly RelationshipView[], otherId: string | null, key: RelationshipKey | "", side: "a" | "b" | ""): FlagHint | null {
  if (!otherId || key === "" || side !== "a") return null;
  const flag = FLAG_OF_LABEL[key];
  if (!flag) return null;
  const id = otherId.toLowerCase();
  const rows = views.filter((v) => v.person !== null && v.person.id.toLowerCase() === id);
  const view = rows.find((v) => v[flag]) ?? rows[0];
  return view ? { view, flag, on: view[flag] } : null;
}

const FLAG_WORD = { canPickUp: "relationships.flag.canPickUp", isEmergency: "relationships.flag.isEmergency" } as const;

export function flagHintText(hint: FlagHint, locale: Locale, names: { hidden: string; noName: string }): string {
  const params = { row: chipText(hint.view, locale, names), flag: t(m, FLAG_WORD[hint.flag], locale) };
  return t(m, hint.on ? "relationships.dialog.flagAlreadyOn" : "relationships.dialog.flagOnRow", locale, params);
}

/** The picker's last answer, paired with the exact term it was searched for. */
export type SearchAnswer<H> = { term: string; hits: readonly H[] | "failed" };

/**
 * What the picker shows for the term in the box (final review item 7): an answer for an earlier
 * term is never shown under a new one, so a person picked from the list is always someone the
 * current term found. "pending" until this term's own answer arrives.
 */
export function hitsToShow<H>(answer: SearchAnswer<H> | null, term: string): readonly H[] | "failed" | "pending" | "idle" {
  if (term.trim().length < 2) return "idle";
  if (!answer || answer.term !== term) return "pending";
  return answer.hits;
}

export type FailedAddState = { createdId: string | null; personSaved: boolean };

/**
 * What the dialog keeps after a failed add (final review item 7). A "New person" the server
 * already saved or matched is retried by id (finding 3); the "saved" line shows only when this
 * dialog's add CREATED them, never when the hand-add matched someone already saved, and it stays
 * through a second failure on the retry.
 */
export function afterFailedAdd(
  prev: FailedAddState, mode: "find" | "new", r: { contactId?: string; created?: boolean },
): FailedAddState {
  if (mode !== "new" || !r.contactId) return prev;
  return { createdId: r.contactId, personSaved: prev.personSaved || r.created === true };
}
