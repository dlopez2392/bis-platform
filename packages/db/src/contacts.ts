import type { SupabaseClient } from "@supabase/supabase-js";

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

async function emit(db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object) {
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: "user", actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

export async function createContact(
  db: SupabaseClient, accountId: string, input: ContactInput, actorId: string,
): Promise<{ id: string; existing: boolean }> {
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  if (email || phone) {
    let q = db.from("contacts").select("id").eq("account_id", accountId).limit(1);
    if (email && phone) q = q.or(`email.ilike."${email}",phone.eq."${phone}"`);
    else if (email) q = q.ilike("email", email);
    else q = q.eq("phone", phone!);
    const { data: dupe } = await q;
    if (dupe && dupe.length > 0) return { id: dupe[0]!.id, existing: true };
  }
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, ...toRow(input) }).select("id").single();
  if (error || !data) throw new Error(`createContact failed: ${error?.message}`);
  await emit(db, accountId, "contact.created", actorId, { contactId: data.id, email, phone });
  return { id: data.id, existing: false };
}

export async function updateContact(
  db: SupabaseClient, accountId: string, contactId: string,
  input: Partial<ContactInput>, actorId: string,
): Promise<void> {
  const { error } = await db.from("contacts")
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId);
  if (error) throw new Error(`updateContact failed: ${error.message}`);
  await emit(db, accountId, "contact.updated", actorId, { contactId, fields: Object.keys(input) });
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
