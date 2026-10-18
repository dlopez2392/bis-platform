import { isRequirableCategory, type RequirableCategory } from "@bis/db/document-rules";

/**
 * The To-do -> Documents card link (S-07 3a, spec 3.2; plan deviations 5, 6), both directions in one
 * place. `?document=<id>` scrolls the card to that file and focuses it; `?ask=<category>` pre-ticks it
 * when staff press Ask the customer (only the eight requirable categories: 2c D8). Browser-safe.
 */
export type CardFocus = { documentId: string | null; ask: RequirableCategory | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cardFocusFrom(sp: { document?: unknown; ask?: unknown } | undefined): CardFocus | undefined {
  const documentId = typeof sp?.document === "string" && UUID.test(sp.document) ? sp.document.toLowerCase() : null;
  const ask = isRequirableCategory(sp?.ask) ? sp.ask : null;
  return documentId || ask ? { documentId, ask } : undefined;
}

export function workRowHref(
  accountId: string,
  row: { contactId: string | null; documentFocus?: { documentId: string; category: string | null; groupId: string | null } | null },
): string | null {
  const base = `/dashboard/accounts/${accountId}`;
  const f = row.documentFocus;
  if (f) {
    const q = new URLSearchParams({ document: f.documentId });
    if (isRequirableCategory(f.category)) q.set("ask", f.category);
    if (f.groupId) return `${base}/groups/${f.groupId}?${q}`;
    if (row.contactId) return `${base}/contacts/${row.contactId}?${q}`;
  }
  return row.contactId ? `${base}/contacts/${row.contactId}` : null;
}
