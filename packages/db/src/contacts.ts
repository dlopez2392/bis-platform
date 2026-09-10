import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";

export type ContactInput = {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  companyName?: string; source?: string; custom?: Record<string, unknown>;
};

// `sort_name` (0030, a stored generated column) rides along on every read —
// not just when sorting by name — because the caller building the NEXT
// cursor (apps/web's contacts/page.tsx) needs whichever column the CURRENT
// sort used off the last row, and that is cheapest to guarantee by always
// selecting it rather than conditionally shaping this string per sort key.
const COLS =
  "id, first_name, last_name, email, phone, company_name, source, custom, created_at, updated_at, sort_name";

function toRow(input: Partial<ContactInput>) {
  const row: Record<string, unknown> = {};
  if (input.firstName !== undefined) row.first_name = input.firstName;
  if (input.lastName !== undefined) row.last_name = input.lastName;
  if (input.email !== undefined) row.email = input.email?.trim() || null;
  if (input.phone !== undefined) row.phone = input.phone?.trim() || null;
  if (input.companyName !== undefined) row.company_name = input.companyName;
  if (input.source !== undefined) row.source = input.source;
  if (input.custom !== undefined) row.custom = input.custom;
  return row;
}

/**
 * Two plain filters instead of one interpolated `.or()` string.
 *
 * The previous form built `email.ilike."${email}",phone.eq."${phone}"` by
 * interpolation. That was safe only because every caller was an operator
 * typing into the CRM; a public form makes this value attacker-controlled, and
 * an email containing `"` or `,` breaks out of PostgREST's filter grammar.
 * `.eq`/`.ilike` send their operand as a parameter, so nothing can escape it.
 * Two round trips instead of one is the right price.
 *
 * The previous form also discarded the query's `error` (`const { data: dupe }
 * = await q`), so a filter that failed to parse silently became "no duplicate
 * found" rather than a thrown error — a second, duplicate contact row got
 * written instead of anything visibly failing. Both branches below check
 * `error` and throw, so a broken lookup can no longer masquerade as "no
 * match."
 *
 * `email` still reaches `.ilike()`, and `.ilike()`'s operand is a SQL ILIKE
 * *pattern*, not a plain equality value — parameterizing it (above) stops it
 * from escaping PostgREST's filter grammar, but does nothing about `%`/`_`,
 * which ILIKE itself interprets as wildcards. `guards.ts`'s `EMAIL_RE` now
 * rejects both at the public form boundary, but this lookup is also reached
 * by the authenticated operator path (typing an email into the CRM directly),
 * which has no such validation. `escapeLikePattern` neutralizes both
 * characters (and a literal backslash, which would otherwise itself become an
 * escape) so the email is matched as a literal string either way.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Comparison key for phone dedupe: digits only, with a leading NANP country
 * code folded off. contacts.phone is only trimmed on write, never reshaped
 * — an operator or a web form routinely leaves it as "(956) 292-1696", while
 * an inbound SMS sender's number (or anything already run through
 * lib/voice/phone-number.ts's toE164) arrives as "+19562921696". Both are
 * the same ten digits and must resolve to the same contact; an exact string
 * match on the raw column never sees that, and forked a duplicate contact
 * (and, upstream, a second conversation thread) for the majority phone
 * shape in this database. Comparison-only — this never gets written back;
 * the stored column keeps whatever shape it was entered in.
 */
export function phoneDigits(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

async function findDuplicate(
  db: SupabaseClient, accountId: string, email?: string, phone?: string,
): Promise<string | null> {
  if (email) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).ilike("email", escapeLikePattern(email)).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) return data[0]!.id;
  }
  if (phone) {
    // Fast path first: an exact string match still hits the
    // `contacts_account_phone (account_id, phone)` index directly, and
    // covers the common case where both sides already agree on shape (two
    // inbound texts from the same already-E.164-stored number; two
    // identical operator entries).
    const { data: exact, error: exactErr } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone", phone).limit(1);
    if (exactErr) throw new Error(`contact dedupe failed: ${exactErr.message}`);
    if (exact && exact.length > 0) return exact[0]!.id;

    // Fallback: normalized-digit comparison for the case the exact match
    // can't see (see phoneDigits' comment). Still scoped by the same
    // account_id the exact match used, so this still uses that index's
    // leading column — it just can't use the second column once the
    // comparison is digits-based rather than string-based, so it pulls
    // every non-null phone on THIS account (never cross-tenant) and
    // compares in memory.
    const key = phoneDigits(phone);
    if (key) {
      const { data, error } = await db.from("contacts").select("id, phone")
        .eq("account_id", accountId).not("phone", "is", null);
      if (error) throw new Error(`contact dedupe failed: ${error.message}`);
      const match = (data ?? []).find(
        (row) => row.phone && phoneDigits(row.phone as string) === key,
      );
      if (match) return match.id as string;
    }
  }
  return null;
}

export async function createContact(
  db: SupabaseClient, accountId: string, input: ContactInput, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string; existing: boolean }> {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  const dupe = await findDuplicate(db, accountId, email || undefined, phone || undefined);
  if (dupe) return { id: dupe, existing: true };

  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, ...toRow(input) }).select("id").single();
  if (error || !data) throw new Error(`createContact failed: ${error?.message}`);
  await emit(db, accountId, "contact.created", actorId, { contactId: data.id, email, phone },
    actorType);
  return { id: data.id, existing: false };
}

export async function updateContact(
  db: SupabaseClient, accountId: string, contactId: string,
  input: Partial<ContactInput>, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { error } = await db.from("contacts")
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`updateContact failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: Object.keys(input) },
    actorType);
}

/**
 * Fills ONLY blank fields on an existing contact — the voice dedupe
 * follow-up (a returning caller's name/email must not stay "Caller"/NULL,
 * but a misheard name must never clobber a good record). Blank = null or
 * empty after trim. "Caller" with no last name is our own finish-call
 * placeholder and counts as blank for the name pair only.
 * Returns the column names actually written; [] means no update ran.
 */
export async function fillContactBlanks(
  db: SupabaseClient, accountId: string, contactId: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string },
  actorId: string, actorType: ActorType = "user",
): Promise<string[]> {
  const row = await getContact(db, accountId, contactId);
  if (!row) throw new Error("fillContactBlanks: no such contact");
  const blank = (v: unknown) => v == null || String(v).trim() === "";

  const patch: Record<string, unknown> = {};
  const nameIsPlaceholder = row.first_name === "Caller" && blank(row.last_name);
  const incomingFirst = input.firstName?.trim();
  const incomingLast = input.lastName?.trim();

  // Whether a blank last_name is safe to fill on its own — i.e. without a
  // first_name write riding along in the same call. "Safe" means there's no
  // real first name on file to contradict: it's blank, it's our own
  // "Caller" placeholder, or it already matches the incoming first name
  // (case-insensitive, trimmed). This is the guard that stops "Smith" from
  // grafting onto a contact whose actual first name differs from this
  // caller's — a stranger who merely dedupe-matched on phone.
  const firstNameCompatible = blank(row.first_name) || nameIsPlaceholder ||
    (!!incomingFirst && incomingFirst.toLowerCase() === String(row.first_name).trim().toLowerCase());

  if (incomingFirst && (blank(row.first_name) || nameIsPlaceholder)) {
    patch.first_name = incomingFirst;
    if (incomingLast && blank(row.last_name)) patch.last_name = incomingLast;
  } else if (incomingLast && blank(row.last_name) && firstNameCompatible) {
    // Independent fill: first_name isn't being written this call (it's
    // already a real, non-placeholder name), but last_name can still be
    // filled on its own — e.g. a contact created as just "John" who a later
    // caller identifies as "John Smith" must not stay surnameless forever.
    patch.last_name = incomingLast;
  }
  const incomingEmail = input.email?.trim().toLowerCase();
  if (incomingEmail && blank(row.email)) patch.email = incomingEmail;
  const incomingPhone = input.phone?.trim();
  if (incomingPhone && blank(row.phone)) patch.phone = incomingPhone;

  const filled = Object.keys(patch);
  if (filled.length === 0) return [];

  const { error } = await db.from("contacts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`fillContactBlanks failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: filled }, actorType);
  return filled;
}

/** The three columns the contacts list can be sorted by, and the two
 *  directions — Task 3b's server-side sort, replacing the old client-side
 *  one that could only ever reorder the rows already in the browser. */
export type SortKey = "name" | "company" | "created";
export type SortDir = "asc" | "desc";
export type ContactSort = { key: SortKey; dir: SortDir };

/** `name`/`company` sort on nullable columns (a contact can have neither a
 *  name nor a company); `created` sorts on `created_at`, which is `not
 *  null`. Nulls sort LAST in BOTH directions (0030's own design, so a
 *  nameless contact does not interleave among the Ns) — this table is what
 *  tells the cursor's `.or()` below whether it needs the extra
 *  `column.is.null` disjunct to step across that boundary. */
const SORT_COLUMN: Record<SortKey, string> = {
  name: "sort_name",
  company: "company_name",
  created: "created_at",
};
const SORT_NULLABLE: Record<SortKey, boolean> = {
  name: true,
  company: true,
  created: false,
};

/**
 * Escapes a value for embedding inside a PostgREST `.or()` filter string.
 *
 * The cursor's `v` (apps/web/src/lib/cursor.ts's `RowCursor`) is DELIBERATELY
 * opaque now — `parseCursor` checks only that it is a string or null, never
 * its shape. The `created_at` branch below used to interpolate its cursor
 * value unescaped, which was safe only because the OLD parser's `isTs` regex
 * validated it as a timestamp first, excluding every character PostgREST's
 * grammar treats specially. A name or company has no such shape: a real one
 * can contain a comma, a period, parentheses, or a double quote — this file's
 * own `escapeLikePattern`/`sanitizeSearchTerm` neighbours exist because this
 * exact class of bug already happened here once (see the block comment above
 * `escapeLikePattern`). PostgREST's own escape rule is to double-quote the
 * value and backslash-escape a literal `\` or `"` inside it — backslash
 * first, so an input holding both round-trips either way. Proven against the
 * real database in this file's own "PostgREST-reserved character" test.
 */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A row's position in this list's (possibly sorted) ordering — `v` is the
 *  CURRENT sort column's own value off the last row shown, `id` the
 *  tiebreaker that makes it total. Structurally identical to apps/web's
 *  `RowCursor` (apps/web/src/lib/cursor.ts); redeclared because @bis/db must
 *  not import from the app. */
export type ContactCursor = { v: string | null; id: string };

/**
 * Applies the shared name/email/phone search filter, or returns `q` unchanged.
 *
 * Was a local `.replace(/[%,()]/g, "")`, which left `"` and `\` in place —
 * both break the interpolated .or() string below (see search-term.ts, and
 * this file's own comment block above escapeLikePattern). Harmless while only
 * a deliberate CRM search reached it; P6 put this call behind every keystroke
 * of the ⌘K palette.
 */
function withSearch<T>(q: T, search?: string): T {
  const s = search ? sanitizeSearchTerm(search) : undefined;
  if (!s) return q;
  return (q as { or: (f: string) => T }).or(
    `first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`,
  );
}

export async function listContacts(
  db: SupabaseClient, accountId: string,
  opts: { search?: string; limit?: number; before?: ContactCursor; sort?: ContactSort } = {},
) {
  const sort: ContactSort = opts.sort ?? { key: "created", dir: "desc" };
  const column = SORT_COLUMN[sort.key];
  const ascending = sort.dir === "asc";

  let q = db.from("contacts").select(COLS).eq("account_id", accountId)
    // Two-key ordering: the sort column alone is not unique — two contacts
    // can share a name or a company, and a CSV import (Task 6) writes
    // thousands of rows in the same created_at millisecond — so id breaks
    // the tie and makes the cursor below total (every row has a strict
    // position). `nullsFirst: false` keeps a nameless/company-less contact
    // LAST regardless of direction (0030's own design); it is a no-op for
    // `created_at`, which is `not null`, so this needs no per-key branch.
    .order(column, { ascending, nullsFirst: false })
    .order("id", { ascending })
    .limit(opts.limit ?? 50);
  q = withSearch(q, opts.search);
  if (opts.before) {
    const { v, id } = opts.before;
    const cmp = ascending ? "gt" : "lt";
    if (v === null) {
      // Already inside the null block (only reachable when this column is
      // nullable) — every remaining row has a null sort column too, so only
      // the id tiebreaker advances.
      q = q.or(`and(${column}.is.null,id.${cmp}.${id})`);
    } else {
      // Row-value comparison: everything strictly past (column, id) in the
      // ordering above, expressed as PostgREST's `or` of the two cases —
      // `v` is quoted (see quoteFilterValue) because it is now free text,
      // never re-derived or round-tripped through anything that could
      // reshape it, so it still matches the stored value exactly.
      const value = quoteFilterValue(v);
      const clause = `${column}.${cmp}.${value},and(${column}.eq.${value},id.${cmp}.${id})`;
      // Nullable columns: the remaining rows are the strictly-greater/lesser
      // non-nulls PLUS every null — nulls sort last in BOTH directions, so
      // they are still "not yet shown" the moment `v` is a real value.
      q = q.or(SORT_NULLABLE[sort.key] ? `${clause},${column}.is.null` : clause);
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function getContact(db: SupabaseClient, accountId: string, contactId: string) {
  const { data, error } = await db.from("contacts").select(COLS)
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function addTagToContact(
  db: SupabaseClient, accountId: string, contactId: string, tagName: string,
): Promise<void> {
  const name = tagName.trim().toLowerCase();
  if (!name) return;
  const { data: tag, error: tErr } = await db.from("tags")
    .upsert({ account_id: accountId, name }, { onConflict: "account_id,name" })
    .select("id").single();
  if (tErr || !tag) throw new Error(`tag upsert failed: ${tErr?.message}`);
  const { error } = await db.from("contact_tags")
    .upsert({ contact_id: contactId, tag_id: tag.id, account_id: accountId },
            { onConflict: "contact_id,tag_id" });
  if (error) throw new Error(`contact_tags upsert failed: ${error.message}`);
}

export async function removeTagFromContact(
  db: SupabaseClient, accountId: string, contactId: string, tagId: string,
): Promise<void> {
  const { error } = await db.from("contact_tags").delete()
    .eq("account_id", accountId).eq("contact_id", contactId).eq("tag_id", tagId);
  if (error) throw new Error(error.message);
}

export async function listContactTags(db: SupabaseClient, accountId: string, contactId: string) {
  const { data, error } = await db.from("contact_tags")
    .select("tag_id, tags(id, name)").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.tags.id as string, name: r.tags.name as string }));
}

/**
 * Dashboard KPI tile: total contacts on the account, right now. `opts` is
 * optional so the dashboard's existing two-argument call keeps compiling
 * untouched; the contacts list (Task 3) passes `search` so its "N results"
 * caption counts what the filter matches, not the whole account.
 */
export async function countContacts(
  db: SupabaseClient, accountId: string, opts: { search?: string } = {},
): Promise<number> {
  let q = db.from("contacts").select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  q = withSearch(q, opts.search);
  const { count, error } = await q;
  if (error) throw new Error(`countContacts failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Bulk tag: one tag upsert + one contact_tags bulk upsert. Same
 * trim/lowercase normalization as addTagToContact so "VIP" and "vip"
 * are the same tag. Returns the tagId so the caller can offer undo.
 */
export async function addTagToContacts(
  db: SupabaseClient, accountId: string, contactIds: string[], tagName: string,
): Promise<{ tagId: string; applied: number }> {
  const name = tagName.trim().toLowerCase();
  if (!name || contactIds.length === 0) throw new Error("addTagToContacts: nothing to do");
  const { data: tag, error: tErr } = await db.from("tags")
    .upsert({ account_id: accountId, name }, { onConflict: "account_id,name" })
    .select("id").single();
  if (tErr || !tag) throw new Error(`tag upsert failed: ${tErr?.message}`);
  const rows = contactIds.map((contactId) => ({
    contact_id: contactId, tag_id: tag.id, account_id: accountId,
  }));
  const { error } = await db.from("contact_tags")
    .upsert(rows, { onConflict: "contact_id,tag_id" });
  if (error) throw new Error(`contact_tags bulk upsert failed: ${error.message}`);
  return { tagId: tag.id, applied: contactIds.length };
}

/** Undo for addTagToContacts: strip ONE tag from the same id set. */
export async function removeTagFromContacts(
  db: SupabaseClient, accountId: string, contactIds: string[], tagId: string,
): Promise<void> {
  if (contactIds.length === 0) return;
  const { error } = await db.from("contact_tags").delete()
    .eq("account_id", accountId).eq("tag_id", tagId).in("contact_id", contactIds);
  if (error) throw new Error(error.message);
}

/** The account's tag vocabulary, for pickers. Alphabetical. */
export async function listTags(
  db: SupabaseClient, accountId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.from("tags")
    .select("id, name").eq("account_id", accountId).order("name");
  if (error) throw new Error(`listTags failed: ${error.message}`);
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Bulk delete with skip-blocked semantics. opportunities.contact_id and
 * conversations.contact_id are NO ACTION FKs, and bookings.contact_id is
 * `on delete restrict` BY DESIGN (0017) — a single unfiltered
 * `delete … in (…)` would abort the whole batch on one linked contact.
 * So: pre-read which ids have any blocking child, delete only the rest in
 * one statement, and report both counts honestly. contact_tags/notes/tasks
 * cascade; form_submissions and calls set-null (schema, not our concern
 * here). Deliberately NO event emit: `contact.deleted` is not a curated
 * ledger type and the ledger fails closed on unknown types.
 */
export async function deleteContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ deleted: number; skippedBlocked: number }> {
  if (contactIds.length === 0) return { deleted: 0, skippedBlocked: 0 };
  const blocked = new Set<string>();
  for (const table of ["opportunities", "conversations", "bookings"] as const) {
    const { data, error } = await db.from(table).select("contact_id")
      .eq("account_id", accountId).in("contact_id", contactIds);
    if (error) throw new Error(`deleteContacts ${table} pre-read failed: ${error.message}`);
    for (const r of data ?? []) if (r.contact_id) blocked.add(r.contact_id as string);
  }
  const deletable = contactIds.filter((id) => !blocked.has(id));
  if (deletable.length === 0) return { deleted: 0, skippedBlocked: blocked.size };
  const { data, error } = await db.from("contacts").delete()
    .eq("account_id", accountId).in("id", deletable).select("id");
  if (error) throw new Error(`deleteContacts failed: ${error.message}`);
  return { deleted: (data ?? []).length, skippedBlocked: blocked.size };
}
