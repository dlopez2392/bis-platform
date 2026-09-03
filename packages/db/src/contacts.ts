import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";

export type ContactInput = {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  companyName?: string; source?: string; custom?: Record<string, unknown>;
};

const COLS = "id, first_name, last_name, email, phone, company_name, source, custom, created_at, updated_at";

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
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone", phone).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) return data[0]!.id;
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

export async function listContacts(
  db: SupabaseClient, accountId: string, opts: { search?: string; limit?: number } = {},
) {
  let q = db.from("contacts").select(COLS)
    .eq("account_id", accountId).order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  // Was a local `.replace(/[%,()]/g, "")`, which left `"` and `\` in place —
  // both break the interpolated .or() string one line below (see
  // search-term.ts, and this file's own comment block above escapeLikePattern).
  // Harmless while only a deliberate CRM search reached it; P6 put this call
  // behind every keystroke of the ⌘K palette.
  const s = opts.search ? sanitizeSearchTerm(opts.search) : undefined;
  if (s) q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
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

/** Dashboard KPI tile: total contacts on the account, right now. */
export async function countContacts(db: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await db.from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
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
