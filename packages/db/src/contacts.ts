import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

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

export async function listContacts(
  db: SupabaseClient, accountId: string, opts: { search?: string; limit?: number } = {},
) {
  let q = db.from("contacts").select(COLS)
    .eq("account_id", accountId).order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  const s = opts.search?.trim().replace(/[%,()]/g, "");
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
