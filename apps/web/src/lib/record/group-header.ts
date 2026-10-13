import type { GroupMember, PlaceRow } from "@bis/db";
import type { RecordHeaderAction } from "@/components/record/record-header";
import { encodeCursor } from "@/lib/cursor";
import { mapUrl } from "@/lib/contacts/place-view";
import { headerActions, type HeaderActionId } from "./header-actions";
import type { Tr } from "./copy";

/** A member's name in the PAGE's language: contactDisplayName reads the English catalogue (lib/format.ts:119-124). */
export function memberName(p: { firstName: string | null; lastName: string | null }, tr: Tr): string {
  return [p.firstName, p.lastName].filter((s): s is string => Boolean(s && s.trim())).join(" ") || tr.text("contact.noName");
}
/** "Call Ana": the first name, else the whole display name (spec §8.1). */
export function memberFirstName(p: { firstName: string | null; lastName: string | null }, tr: Tr): string {
  return p.firstName?.trim() || memberName(p, tr);
}

/** D4: the group's first ACTIVE addressed place, in the read's order, else the call-first member's own first. */
export function firstGroupMapUrl(groupPlaces: readonly PlaceRow[], primaryOwn: readonly PlaceRow[]): string | null {
  for (const list of [groupPlaces, primaryOwn]) {
    for (const p of list) {
      if (p.archived_at) continue;
      const url = mapUrl(p);
      if (url) return url;
    }
  }
  return null;
}

const LABEL = {
  call: "groupPage.action.call", text: "groupPage.action.text", email: "groupPage.action.email", directions: "record.action.directions",
} as const satisfies Record<HeaderActionId, string>;

/**
 * The group header's actions (spec §8.1): Call (the ONE primary), Text and Email go to the call-first
 * member and name them; with none visible, all three are hidden (D4; part 1 D3: an action with
 * nothing behind it is hidden) and Directions still shows. `canText` is C14's gate, decided by the page.
 */
export function groupHeaderActions(input: {
  accountId: string; primary: GroupMember | null; canText: boolean; directionsUrl: string | null; tr: Tr;
}): RecordHeaderAction[] {
  const p = input.primary;
  const actions = headerActions({
    phone: p?.phone ?? null, email: p?.email ?? null, canText: p !== null && input.canText, directionsUrl: input.directionsUrl,
    composeHref: p ? `/dashboard/accounts/${input.accountId}/contacts/${p.contactId}` : undefined,
  });
  const name = p ? memberFirstName(p, input.tr) : "";
  return actions.map((a) => ({ ...a, label: a.id === "directions" ? input.tr.text(LABEL.directions) : input.tr.text(LABEL[a.id], { name }) }));
}

/** People's anchor, so its pager lands on the card. */
export const PEOPLE_ANCHOR = "group-people";
const QA_LOCALES = new Set(["en", "es", "pseudo"]);

/** People's one pager (C10): "More people" carries ?people=, "Back to the start" drops it. Only ?locale= is kept (plan deviation 14). */
export function peoplePagerHrefs(p: {
  basePath: string; next: { v: string; id: string } | null; paged: boolean; locale?: unknown;
}): { moreHref: string | null; firstHref: string | null } {
  const keep: Record<string, string> = typeof p.locale === "string" && QA_LOCALES.has(p.locale) ? { locale: p.locale } : {};
  const href = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...keep, ...extra }).toString();
    return `${p.basePath}${qs ? `?${qs}` : ""}#${PEOPLE_ANCHOR}`;
  };
  return { moreHref: p.next ? href({ people: encodeCursor(p.next) }) : null, firstHref: p.paged ? href({}) : null };
}
