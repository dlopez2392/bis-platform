import { isDocumentCategory, shiftDay, type DocumentCategory } from "@bis/db/document-rules";
import type { AccountDocument, AccountDocumentsShow } from "@bis/db";
import type { DocumentView } from "@/lib/documents/documents-load";
import { encodeCursor, parseCursor } from "@/lib/cursor";

/**
 * The Documents page's URL and pager (S-07 3a, spec 3.1). Server-side (lib/cursor.ts uses Buffer). Every
 * parameter is hand-editable, so anything that does not fit reads as the default, never a throw: `show`
 * defaults to Expiring soon, a category must be one of the nine, and a cursor must fit its list (a day
 * for the two expiry lists, an instant for All) on a REAL calendar day: listAccountDocuments throws on an
 * impossible day, and Postgres refuses an instant on one ("2026-02-30T..." passes Date.parse, which rolls
 * it over), so either would be the error state where a hand-edited URL deserves page one. One pager: Next carries the last row's (sort key, id);
 * Back to the start drops the cursor (plan deviation 8).
 */
export const DOCUMENTS_PAGE_SIZE = 50;
export type DocumentsQuery = { show: AccountDocumentsShow; category: DocumentCategory | null; cursor: { v: string; id: string } | undefined };
export type DocumentsRowView = { doc: DocumentView; filedOn: { name: string; href: string } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T/;
/** The day part is one the calendar has: shiftDay rolls "2026-02-31" over to Mar 3, so it no longer matches itself. */
const realDay = (v: string) => shiftDay(v.slice(0, 10), 0) === v.slice(0, 10);

export function documentsQuery(sp: { show?: unknown; category?: unknown; before?: unknown }): DocumentsQuery {
  const show: AccountDocumentsShow = sp.show === "expired" || sp.show === "all" ? sp.show : "expiring";
  const category = typeof sp.category === "string" && isDocumentCategory(sp.category) ? sp.category : null;
  const parsed = parseCursor(typeof sp.before === "string" ? sp.before : undefined);
  const v = parsed?.v;
  const fits = typeof v === "string" && realDay(v)
    && (show === "all" ? INSTANT.test(v) && !Number.isNaN(Date.parse(v)) : DAY.test(v));
  return { show, category, cursor: fits && parsed ? { v, id: parsed.id } : undefined };
}

export function documentsHref(base: string, q: { show: AccountDocumentsShow; category: DocumentCategory | null }, before?: string): string {
  const p = new URLSearchParams({ show: q.show });
  if (q.category) p.set("category", q.category);
  if (before) p.set("before", before);
  return `${base}?${p}`;
}

export function documentsPagerHrefs(
  base: string, q: DocumentsQuery, hasMore: boolean, last: { id: string; created_at: string; expires_on: string | null } | undefined,
): { next: string | null; first: string | null } {
  const v = last ? (q.show === "all" ? last.created_at : last.expires_on) : null;
  return {
    next: hasMore && last && v ? documentsHref(base, q, encodeCursor({ v, id: last.id })) : null,
    first: q.cursor ? documentsHref(base, q) : null,
  };
}

export function filedOnView(
  accountId: string, d: Pick<AccountDocument, "contact" | "group" | "contact_id" | "client_group_id">, noName: string,
): { name: string; href: string } {
  const base = `/dashboard/accounts/${accountId}`;
  if (d.client_group_id) return { name: d.group?.name?.trim() || noName, href: `${base}/groups/${d.client_group_id}` };
  const name = [d.contact?.first_name, d.contact?.last_name].map((s) => s?.trim()).filter(Boolean).join(" ");
  return { name: name || noName, href: `${base}/contacts/${d.contact_id}` };
}
