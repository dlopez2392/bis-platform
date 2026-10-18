import type { SupabaseClient } from "@supabase/supabase-js";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import {
  cleanRequiredCategories, isRequirableCategory, isRequirementState, type RequirableCategory, type RequirementState,
} from "./document-rules";

/**
 * The "7 de 9" checklist's data layer (0081; spec section 5). READS take the caller's client: the
 * checklist's states come from the definer function (it re-checks the account and the contact), the
 * skip proof reads run under 0081's RLS. WRITES take the service client an action holds AFTER its
 * request-client proof (0053): `authenticated` has no write grant on the table or the column. Every
 * write is scoped to `accountId`. THROWS on a read or write error. No event is emitted (plan "Not in
 * this PR"): the timeline row is the record of a skip.
 */
export type DocumentRequirement = { category: RequirableCategory; state: RequirementState };
export type DocumentSkipRow = {
  id: string; account_id: string; contact_id: string; category: RequirableCategory; skipped_by: string; created_at: string;
  unskipped_at: string | null; unskipped_by: string | null;
};
export type TimelineDocumentSkip = {
  id: string; category: RequirableCategory; contact_id: string; skipped_by: string; created_at: string;
  unskipped_by: string | null; unskipped_at: string | null;
};

const SKIP_COLS = "id, account_id, contact_id, category, skipped_by, created_at, unskipped_at, unskipped_by";
const SKIP_TIMELINE_COLS = "id, category, contact_id, skipped_by, created_at, unskipped_by, unskipped_at";

/** The card's read (request client): one row per required category, in the account's order; [] when the list is off. */
export async function listDocumentRequirements(
  db: SupabaseClient, accountId: string, contactId: string, today: string,
): Promise<DocumentRequirement[]> {
  const { data, error } = await db.rpc("document_requirements", { p_account_id: accountId, p_contact_id: contactId, p_today: today });
  if (error) throw new Error(`document_requirements failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`document_requirements: unexpected answer ${JSON.stringify(data)}`);
  return data.map((r: unknown) => {
    const row = r as { category?: unknown; state?: unknown };
    if (!isRequirableCategory(row.category) || !isRequirementState(row.state)) {
      throw new Error(`document_requirements: unexpected answer ${JSON.stringify(r)}`);
    }
    return { category: row.category, state: row.state };
  });
}

export async function getRequiredDocumentCategories(db: SupabaseClient, accountId: string): Promise<RequirableCategory[]> {
  const { data, error } = await db.from("accounts").select("required_document_categories").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getRequiredDocumentCategories failed: ${error.message}`);
  if (!data) throw new Error("getRequiredDocumentCategories: no account");
  const list = cleanRequiredCategories((data as { required_document_categories: unknown }).required_document_categories);
  if (!list) throw new Error("getRequiredDocumentCategories: unexpected stored list");
  return list;
}

/** Service client, after the caller's role check. Writes the cleaned list and answers it. */
export async function setRequiredDocumentCategories(db: SupabaseClient, accountId: string, categories: unknown): Promise<RequirableCategory[]> {
  const list = cleanRequiredCategories(categories);
  if (!list) throw new TypeError("setRequiredDocumentCategories: not a list of requirable categories");
  const { data, error } = await db.from("accounts").update({ required_document_categories: list }).eq("id", accountId).select("id");
  if (error) throw new Error(`setRequiredDocumentCategories failed: ${error.message}`);
  if ((data ?? []).length !== 1) throw new Error("setRequiredDocumentCategories: no account");
  return list;
}

export async function getActiveDocumentSkip(
  db: SupabaseClient, accountId: string, contactId: string, category: RequirableCategory,
): Promise<DocumentSkipRow | null> {
  const { data, error } = await db.from("document_requirement_skips").select(SKIP_COLS)
    .eq("account_id", accountId).eq("contact_id", contactId).eq("category", category).is("unskipped_at", null).maybeSingle();
  if (error) throw new Error(`getActiveDocumentSkip failed: ${error.message}`);
  return (data as DocumentSkipRow | null) ?? null;
}

export async function getDocumentSkip(db: SupabaseClient, accountId: string, skipId: string): Promise<DocumentSkipRow | null> {
  const { data, error } = await db.from("document_requirement_skips").select(SKIP_COLS).eq("account_id", accountId).eq("id", skipId).maybeSingle();
  if (error) throw new Error(`getDocumentSkip failed: ${error.message}`);
  return (data as DocumentSkipRow | null) ?? null;
}

/** Service client. A second active skip for the same customer and category is "already" (0081's partial unique index). */
export async function skipDocumentRequirement(db: SupabaseClient, a: {
  accountId: string; contactId: string; category: RequirableCategory; actorId: string;
}): Promise<{ status: "skipped"; skip: DocumentSkipRow } | { status: "already" }> {
  const { data, error } = await db.from("document_requirement_skips").insert({
    // created_at is the column's default, the DATABASE's now() (M6): unskip_after compares it with unskip_document_requirement's now().
    account_id: a.accountId, contact_id: a.contactId, category: a.category, skipped_by: a.actorId,
  }).select(SKIP_COLS).single();
  if (error) {
    if (error.code === "23505") return { status: "already" };
    throw new Error(`skipDocumentRequirement failed: ${error.message}`);
  }
  return { status: "skipped", skip: data as DocumentSkipRow };
}

/** Service client: the skip's Undo deletes the row (deviation 2), only while active and only the actor's own. */
export async function undoDocumentSkip(db: SupabaseClient, accountId: string, skipId: string, actorId: string): Promise<boolean> {
  const { data, error } = await db.from("document_requirement_skips").delete()
    .eq("account_id", accountId).eq("id", skipId).eq("skipped_by", actorId).is("unskipped_at", null).select("id");
  if (error) throw new Error(`undoDocumentSkip failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Service client: 0081's unskip_document_requirement, the database's now() under a compare-and-set from active (M6). Answers the stored instant as PostgREST returned it, or null. */
export async function unskipDocumentRequirement(
  db: SupabaseClient, accountId: string, skipId: string, actorId: string,
): Promise<{ unskippedAt: string } | null> {
  const { data, error } = await db.rpc("unskip_document_requirement", { p_account_id: accountId, p_skip_id: skipId, p_actor: actorId });
  if (error) throw new Error(`unskipDocumentRequirement failed: ${error.message}`);
  if (data !== null && typeof data !== "string") throw new Error(`unskipDocumentRequirement: unexpected answer ${JSON.stringify(data)}`);
  return data ? { unskippedAt: data } : null;
}

/** Service client: the un-skip's Undo, only the actor's own at the instant its toast named; never over a newer active skip (23505). */
export async function undoDocumentUnskip(
  db: SupabaseClient, accountId: string, skipId: string, expectedUnskippedAt: string, actorId: string,
): Promise<boolean> {
  const { data, error } = await db.from("document_requirement_skips").update({ unskipped_at: null, unskipped_by: null })
    .eq("account_id", accountId).eq("id", skipId).eq("unskipped_at", expectedUnskippedAt).eq("unskipped_by", actorId).select("id");
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`undoDocumentUnskip failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * The timeline's two reads (spec 5.4; deviation 1), on the caller's client so RLS decides: every skip at
 * its created_at, and every un-skip at its unskipped_at. Each paged on (at, id).
 */
export async function listDocumentSkipTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], page: TimelinePageOpts,
): Promise<{ skips: TimelineDocumentSkip[]; unskips: TimelineDocumentSkip[] }> {
  const base = () => db.from("document_requirement_skips").select(SKIP_TIMELINE_COLS).eq("account_id", accountId);
  const [skips, unskips] = await Promise.all([
    withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page),
    withTimelinePage(forContacts(base().not("unskipped_at", "is", null), "contact_id", who), "unskipped_at", page),
  ]);
  if (skips.error) throw new Error(`listDocumentSkipTimeline (skips) failed: ${skips.error.message}`);
  if (unskips.error) throw new Error(`listDocumentSkipTimeline (un-skips) failed: ${unskips.error.message}`);
  return { skips: (skips.data ?? []) as TimelineDocumentSkip[], unskips: (unskips.data ?? []) as TimelineDocumentSkip[] };
}

/**
 * Service client, after the caller's role check (S-07 3a: the Owner card's Undo; plan deviation 9).
 * Back to `previous` only while the stored list is exactly `expected` (the save's own answer): a
 * compare-and-set, so an Undo never clobbers a newer edit. Answers false when the list moved on.
 */
export async function restoreRequiredDocumentCategories(
  db: SupabaseClient, accountId: string, expected: unknown, previous: unknown,
): Promise<boolean> {
  const e = cleanRequiredCategories(expected);
  const p = cleanRequiredCategories(previous);
  if (!e || !p) throw new TypeError("restoreRequiredDocumentCategories: not lists of requirable categories");
  const { data, error } = await db.from("accounts").update({ required_document_categories: p })
    .eq("id", accountId).eq("required_document_categories", `{${e.join(",")}}`).select("id");
  if (error) throw new Error(`restoreRequiredDocumentCategories failed: ${error.message}`);
  return (data ?? []).length === 1;
}
