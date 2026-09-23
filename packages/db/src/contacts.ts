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
//
// `marketing_email_opted_out_at` (0049) rides along for the contact drawer and
// the detail page, which both show the "No marketing emails" switch off these
// two reads. Snake_case end to end, like every other column here.
const COLS =
  "id, first_name, last_name, email, phone, company_name, source, custom, created_at, updated_at, sort_name, marketing_email_opted_out_at";

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

/**
 * Comparison key for email dedupe, and the twin of `email_key` in migration
 * 0034 (0033's original version of this column drifted from this function —
 * see 0034's own comment). Both sides now strip the SAME explicit whitespace
 * class rather than this side calling JS's `.trim()`: space, tab (\t),
 * newline (\n), carriage return (\r), form feed (\f), vertical tab (\v), and
 * NBSP (\u00A0). `.trim()` looks equivalent but is not — it strips the FULL
 * Unicode whitespace set, which Postgres's `trim()`/regex engine cannot be
 * made to reproduce character-for-character, so a `.trim()` on one side and
 * anything short of an identical class on the other is a standing invitation
 * for the two to diverge again. Spelling the class out explicitly, in the
 * same order, on both sides (see `email_key` in
 * packages/db/supabase/migrations/0034_email_key_whitespace.sql) means a
 * reader can compare the two lists directly rather than trusting that a
 * built-in and a hand-written regex happen to agree.
 *
 * Lowercased, and `+suffix` stripped from the local part (non-global — only
 * the first `+...@` run folds): plus-addressing is near-universal, so
 * `dan+bis@example.com` and `dan@example.com` are one mailbox.
 *
 * Gmail's dot-folding is deliberately NOT applied. `john.smith@` and
 * `johnsmith@` are the same mailbox AT GMAIL ONLY; folding dots globally would
 * match two distinct people at every other provider.
 *
 * Comparison-only — like phoneDigits, this is never written back. The stored
 * column keeps whatever the operator typed.
 */
export function emailKey(value: string): string {
  return value
    .replace(/^[ \t\n\r\f\v\u00A0]+|[ \t\n\r\f\v\u00A0]+$/g, "")
    .toLowerCase()
    .replace(/\+[^@]*@/, "@");
}

type DuplicateMatch = { emailMatch: string | null; phoneMatch: string | null };

/**
 * Both lookups ALWAYS run, and that is the change. The old version returned on
 * the email match and never looked at the phone — so an incoming contact whose
 * email matched one record and whose phone matched ANOTHER was indistinguishable
 * from a plain email match, and the second record silently stayed a duplicate.
 * That is how a duplicate gets created quietly, and it is what the caller now
 * flags (spec §5).
 *
 * Each lookup is a single indexed equality on the generated key columns from
 * migration 0033. The previous phone path had a fast path plus a fallback that
 * pulled every non-null phone on the account into memory and compared in JS —
 * once per inserted contact. The keys make the fallback unnecessary: the
 * database already holds the normalized form, so the same comparison is an
 * index lookup.
 *
 * --- WHY THESE ARE TWO PLAIN FILTERS, AND WHY NEITHER IS AN `ilike` ---
 * This lookup is reached from a PUBLIC form, so both operands are
 * attacker-controlled, and it has been the site of that bug class twice.
 * Recorded here because two comments further down this file cite this block as
 * the landmark for it:
 *
 *   1. It once built `email.ilike."${email}",phone.eq."${phone}"` as one
 *      interpolated `.or()` string. An email containing `"` or `,` breaks out
 *      of PostgREST's filter grammar. `.eq()` sends its operand as a parameter,
 *      so nothing can escape it — see `quoteFilterValue` below for the rule
 *      that applies when a value genuinely must be interpolated into `.or()`.
 *   2. It then discarded the query's `error`, so a filter that failed to parse
 *      silently became "no duplicate found" and wrote a second contact row
 *      rather than failing visibly. Both branches below check `error` and throw.
 *   3. The email side matched with `.ilike()`, whose operand is a SQL ILIKE
 *      *pattern*: `%` and `_` stayed live wildcards, so a submitted
 *      `%@example.com` could match — and hijack — any contact at that domain.
 *      An `escapeLikePattern` helper neutralized them. It is gone with the
 *      `ilike`: `.eq("email_key", …)` has no pattern grammar at all, so `%` and
 *      `_` are literal characters by construction rather than by escaping. The
 *      tests that pinned that behaviour are unchanged and still pass.
 */
async function findDuplicate(
  db: SupabaseClient, accountId: string, email?: string, phone?: string,
): Promise<DuplicateMatch> {
  const result: DuplicateMatch = { emailMatch: null, phoneMatch: null };

  const eKey = email ? emailKey(email) : "";
  if (eKey) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("email_key", eKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.emailMatch = data[0]!.id as string;
  }

  const pKey = phone ? phoneDigits(phone) : "";
  if (pKey) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone_key", pKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.phoneMatch = data[0]!.id as string;
  }

  return result;
}

export async function createContact(
  db: SupabaseClient, accountId: string, input: ContactInput, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string; existing: boolean; flagged: boolean }> {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  const match = await findDuplicate(db, accountId, email || undefined, phone || undefined);
  const winner = match.emailMatch ?? match.phoneMatch;

  // Two DIFFERENT existing contacts both look like this person. The row still
  // lands on the email match, unchanged — but the second one is the thing that
  // used to vanish, and it is exactly what a merge tool needs to find later.
  const conflict =
    match.emailMatch !== null &&
    match.phoneMatch !== null &&
    match.emailMatch !== match.phoneMatch;

  let flagged = false;
  if (conflict) {
    const [contactA, contactB] = [match.emailMatch!, match.phoneMatch!].sort();
    // The unique index makes a repeat a no-op rather than a second row, so a
    // 23505 here is the DESIGNED outcome, not a failure. Anything else is real
    // and must not be swallowed: a flag that silently fails to write leaves the
    // queue looking empty, which is worse than not having one.
    const { error } = await db.from("contact_duplicate_flags")
      .insert({ account_id: accountId, contact_a: contactA, contact_b: contactB,
                reason: "email_phone_conflict" });
    if (error && error.code !== "23505") {
      throw new Error(`contact duplicate flag failed: ${error.message}`);
    }
    flagged = true;
  }

  if (winner) return { id: winner, existing: true, flagged };

  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, ...toRow(input) }).select("id").single();
  if (error || !data) throw new Error(`createContact failed: ${error?.message}`);
  await emit(db, accountId, "contact.created", actorId, { contactId: data.id, email, phone },
    actorType);
  return { id: data.id, existing: false, flagged: false };
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
 * can contain a comma, a period, parentheses, or a double quote — this
 * function and its `sanitizeSearchTerm` neighbour exist because this exact
 * class of bug already happened here twice (see the block comment above
 * `findDuplicate`). PostgREST's own escape rule is to double-quote the
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
 * this file's own comment block above findDuplicate). Harmless while only
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

/**
 * The "No marketing emails" switch (migration 0049). `true` stamps the moment
 * the operator recorded the customer's "stop"; `false` clears it to NULL,
 * which is "may receive marketing email" again (the undo).
 *
 * Read by the reactivation walk (excluded in its query) and by the referral
 * ask on the email channel (skipped in the pass). Quote follow-ups and
 * transactional email ignore it.
 *
 * Scoped by account on the writing statement, and `.select("id")` so a write
 * that matched nothing THROWS instead of reporting success: another account's
 * contact, or one deleted in the meantime (the setBranding convention).
 * Re-stamping an already opted-out contact moves the timestamp to now.
 *
 * THE AUDIT RECORD. The column holds only the latest opt-out, and nothing
 * once it is undone, so each write also emits one event naming WHO did it:
 * `contact.marketing_email_opted_out` or `contact.marketing_email_opted_in`,
 * with `actorId`/`actorType` as `updateContact` takes them. Emitted only
 * after the write matched a row: a refused write records nothing. Nothing
 * renders these yet (the contact timeline does not read `events`, and the
 * dashboard feed skips contact.* housekeeping); they are the durable answer
 * to "who switched this, and when".
 */
export async function setMarketingEmailOptOut(
  db: SupabaseClient, accountId: string, contactId: string, optedOut: boolean,
  actorId: string, actorType: ActorType = "user",
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("contacts")
    .update({ marketing_email_opted_out_at: optedOut ? now : null, updated_at: now })
    .eq("account_id", accountId).eq("id", contactId)
    .select("id");
  if (error) throw new Error(`setMarketingEmailOptOut failed: ${error.message}`);
  if (!data?.length) throw new Error(`setMarketingEmailOptOut: no contact ${contactId} on account ${accountId}`);
  await emit(db, accountId,
    optedOut ? "contact.marketing_email_opted_out" : "contact.marketing_email_opted_in",
    actorId, { contactId }, actorType);
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
