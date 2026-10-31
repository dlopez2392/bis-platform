// "Choose a record" (Task 12): the contact search behind it, split out as a
// plain module so the fetch/outcome logic (this file) and the rendered
// outcome (held-email-search-results.tsx) are each testable without a DOM —
// matching held-email-handlers.ts's own reasoning.
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/** Mirrors `/api/accounts/[accountId]/search/route.ts`'s own `SearchHit`
 *  (only the two fields this UI shows). `sublabel` is that route's email-or-
 *  phone line — rendered under the name so two contacts who share a first
 *  and last name are never offered as though they were one. */
export type SearchHitLite = { id: string; label: string; sublabel: string | null };

export type HeldSearchState =
  | { status: "idle" }
  /** `query`: the raw term these hits answered (F-092 part 1, plan Task 10), so the results component can mark
   *  the letters/digits that matched without the caller threading a second prop through. */
  | { status: "ok"; hits: SearchHitLite[]; query: string }
  | { status: "error" };

/**
 * `/api/accounts/[accountId]/search/route.ts`'s own `UNNAMED` constant
 * ("Unnamed contact") is not exported, and is never localized there — the
 * route answers every caller (the ⌘K palette included) in one language on
 * purpose. This is the one place that label reaches a Spanish render (this
 * search box), so it is localized HERE, by matching the known literal: a
 * fragile seam, flagged so a future rename of that constant is visible
 * here too rather than silently falling back to the English fallback name
 * forever.
 */
const UNNAMED_CONTACT_LITERAL = "Unnamed contact";

export function localizeHit(hit: SearchHitLite, locale: Locale): SearchHitLite {
  return hit.label === UNNAMED_CONTACT_LITERAL ? { ...hit, label: t(m, "contact.noName", locale) } : hit;
}

/** Fetches, localizes every hit's label, and never throws — an abort (the
 *  caller's own debounce cancelling a stale request) is the one exception,
 *  re-thrown so the caller's `catch` can tell "cancelled" apart from "this
 *  search failed" without this function swallowing the distinction. */
export async function searchHeldContacts(
  accountId: string,
  query: string,
  locale: Locale,
  signal: AbortSignal,
): Promise<HeldSearchState> {
  // F-092 part 1 (plan Task 10): this box offers a contact, never a call or a conversation — `types=contacts`
  // keeps it from paying for the other two searches.
  const res = await fetch(`/api/accounts/${accountId}/search?q=${encodeURIComponent(query)}&types=contacts`, { signal });
  if (!res.ok) return { status: "error" };
  const payload = (await res.json()) as { contacts?: SearchHitLite[] };
  return { status: "ok", hits: (payload.contacts ?? []).map((hit) => localizeHit(hit, locale)), query };
}
