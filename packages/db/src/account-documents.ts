import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay, type DocumentCategory } from "./document-rules";
import { DOC_COLS, VERSION_COLS, asVersion, readyVersionsOf, type DocumentRow, type DocumentVersionRow, type ListedDocument } from "./documents";

/**
 * The account-wide Documents page (S-07 3a, spec 3.1). The caller's REQUEST client: 0077's RLS decides
 * every row (the record's visibility, the Technician fence, Owners only). Live (not trashed), listed (a
 * ready version), filed on a contact or a group. `today` is the ACCOUNT's day (documentsClock); the
 * expiry filters compare dates, never instants. Cursor paging on (sort key, id); a head count that
 * THROWS on a null count (memory "head-count null"), never zero.
 */
export const ACCOUNT_DOCUMENTS_SHOWS = ["expiring", "expired", "all"] as const;
export type AccountDocumentsShow = (typeof ACCOUNT_DOCUMENTS_SHOWS)[number];
export type AccountDocumentsFilter = { show: AccountDocumentsShow; category: DocumentCategory | null; today: string };
export type AccountDocumentsCursor = { v: string; id: string };
export type AccountDocument = ListedDocument & {
  contact: { id: string; first_name: string | null; last_name: string | null } | null;
  group: { id: string; name: string; kind: "household" | "business" } | null;
};

const SELECT = `${DOC_COLS}, version:document_versions!documents_current_version_fkey(${VERSION_COLS}), `
  + `versions:document_versions!document_versions_document_fkey(${VERSION_COLS}), `
  + "contact:contacts!documents_contact_fkey(id, first_name, last_name), group:client_groups!documents_group_fkey(id, name, kind)";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PostgREST's own quoting inside an .or() string (contacts.ts' quoteFilterValue, redeclared: that one is private). */
const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The builder methods used here, structurally (contacts.ts:759's cast): a reassigned builder with embeds is too deep for tsc. */
type Q = {
  eq(c: string, v: unknown): Q; is(c: string, v: null): Q; not(c: string, op: string, v: unknown): Q;
  gte(c: string, v: string): Q; lte(c: string, v: string): Q; lt(c: string, v: string): Q;
  or(filters: string): Q; order(c: string, o: { ascending: boolean }): Q; limit(n: number): Q;
} & PromiseLike<{ data: unknown[] | null; count?: number | null; error: { message: string } | null }>;

function scoped(q: Q, accountId: string, f: AccountDocumentsFilter): Q {
  // documents_one_record (0077:74): exactly one record column is set, so "a contact or a group" is "no place, no deal".
  let r = q.eq("account_id", accountId).is("deleted_at", null).not("current_version_id", "is", null)
    .is("place_id", null).is("opportunity_id", null);
  if (f.category) r = r.eq("category", f.category);
  if (f.show === "expiring") r = r.gte("expires_on", f.today).lte("expires_on", shiftDay(f.today, DOCUMENT_EXPIRY_WINDOW_DAYS));
  if (f.show === "expired") r = r.lt("expires_on", f.today);
  return r;
}

export async function listAccountDocuments(
  db: SupabaseClient, accountId: string, f: AccountDocumentsFilter, opts: { before?: AccountDocumentsCursor; limit: number },
): Promise<AccountDocument[]> {
  const ascending = f.show === "expiring";
  const column = f.show === "all" ? "created_at" : "expires_on";
  let q = scoped(db.from("documents").select(SELECT) as unknown as Q, accountId, f);
  if (opts.before) {
    const { v, id } = opts.before;
    const fits = UUID.test(id) && (f.show === "all" ? /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) : DAY.test(v));
    if (!fits) throw new TypeError("listAccountDocuments: a cursor that does not fit this list");
    const cmp = ascending ? "gt" : "lt";
    q = q.or(`${column}.${cmp}.${quote(v)},and(${column}.eq.${quote(v)},id.${cmp}.${id})`);
  }
  const { data, error } = await q.order(column, { ascending }).order("id", { ascending }).limit(opts.limit);
  if (error) throw new Error(`listAccountDocuments failed: ${error.message}`);
  return ((data ?? []) as unknown as (DocumentRow & {
    version: DocumentVersionRow | null; versions: DocumentVersionRow[] | null;
    contact: AccountDocument["contact"]; group: AccountDocument["group"];
  })[]).flatMap((r) => (r.version ? [{ ...r, version: asVersion(r.version), versions: readyVersionsOf(r.version, r.versions ?? []) }] : []));
}

export async function countAccountDocuments(db: SupabaseClient, accountId: string, f: AccountDocumentsFilter): Promise<number> {
  const { count, error } = await scoped(db.from("documents").select("id", { count: "exact", head: true }) as unknown as Q, accountId, f);
  if (error) throw new Error(`countAccountDocuments failed: ${error.message}`);
  if (count === null || count === undefined) throw new Error("countAccountDocuments failed: no count returned");
  return count;
}
