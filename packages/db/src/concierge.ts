import type { SupabaseClient } from "@supabase/supabase-js";
import { newPublicId } from "./forms";
import type { VoiceProfileRow } from "./voice";

/** One side of one exchange. Same shape as `calls.transcript`'s
 *  TranscriptEvent, so one reader renders both. */
export type ConciergeTurn = { role: "visitor" | "assistant"; text: string; at: string };

export type ConciergeProfile = VoiceProfileRow & {
  public_id: string; concierge_form_id: string;
};

const PROFILE_CONCIERGE_COLS =
  "id, account_id, persona_name, greeting_en, greeting_es, facts, services, " +
  "languages, booking_enabled, after_hours, enabled, textback_enabled, textback_body, " +
  "public_id, concierge_enabled, concierge_form_id";

/**
 * The tenant seam, third instance of the pattern `/b/[publicId]` and
 * `/f/[publicId]` already use: the public id IS the authorisation to talk --
 * no accountId, no auth, on purpose.
 *
 * Returns null unless the concierge is switched ON and HAS a destination
 * form. An address that resolves to a profile whose widget is off must 404,
 * not open a chat that cannot file anything. Both conditions are in the
 * query rather than checked by the caller, so a second caller cannot forget
 * one.
 */
export async function getVoiceProfileByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<ConciergeProfile | null> {
  const { data, error } = await db.from("voice_profiles")
    .select(PROFILE_CONCIERGE_COLS)
    .eq("public_id", publicId)
    .eq("concierge_enabled", true)
    .not("concierge_form_id", "is", null)
    .maybeSingle();
  if (error) throw new Error(`getVoiceProfileByPublicId failed: ${error.message}`);
  return (data as ConciergeProfile | null) ?? null;
}

/**
 * Switches the concierge on and returns the address the snippet must carry.
 *
 * The public id is minted ONCE and kept: re-enabling after a disable must
 * not change the address, or every snippet already pasted on a client's
 * website silently stops working. So the mint is conditional on the current
 * value, read first.
 */
export async function enableConcierge(
  db: SupabaseClient, accountId: string, formId: string,
): Promise<{ publicId: string }> {
  const { data: existing, error: readErr } = await db.from("voice_profiles")
    .select("public_id").eq("account_id", accountId).maybeSingle();
  if (readErr) throw new Error(`enableConcierge read failed: ${readErr.message}`);
  if (!existing) throw new Error("enableConcierge failed: no voice profile for this account");

  const publicId = (existing as { public_id: string | null }).public_id ?? newPublicId();
  const { error } = await db.from("voice_profiles")
    .update({ public_id: publicId, concierge_enabled: true, concierge_form_id: formId })
    .eq("account_id", accountId);
  if (error) throw new Error(`enableConcierge failed: ${error.message}`);
  return { publicId };
}

/** Switches it off WITHOUT clearing `public_id` -- see enableConcierge. */
export async function disableConcierge(
  db: SupabaseClient, accountId: string,
): Promise<void> {
  const { error } = await db.from("voice_profiles")
    .update({ concierge_enabled: false }).eq("account_id", accountId);
  if (error) throw new Error(`disableConcierge failed: ${error.message}`);
}

export type ConciergeConversationRow = {
  id: string; account_id: string; form_id: string; ip_hash: string;
  turn_count: number; transcript: ConciergeTurn[]; submission_id: string | null;
  locale: string; attribution: Record<string, string>; origin: string | null;
};

const CONVO_COLS =
  "id, account_id, form_id, ip_hash, turn_count, transcript, submission_id, " +
  "locale, attribution, origin";

export async function createConciergeConversation(
  db: SupabaseClient,
  input: { accountId: string; formId: string; ipHash: string; locale: string;
           attribution: Record<string, string>; origin: string | null },
): Promise<{ id: string }> {
  const { data, error } = await db.from("concierge_conversations").insert({
    account_id: input.accountId, form_id: input.formId, ip_hash: input.ipHash,
    locale: input.locale, attribution: input.attribution, origin: input.origin,
  }).select("id").single();
  if (error || !data) throw new Error(`createConciergeConversation failed: ${error?.message}`);
  return { id: data.id as string };
}

export async function getConciergeConversation(
  db: SupabaseClient, id: string,
): Promise<ConciergeConversationRow | null> {
  const { data, error } = await db.from("concierge_conversations")
    .select(CONVO_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`getConciergeConversation failed: ${error.message}`);
  return (data as ConciergeConversationRow | null) ?? null;
}

/**
 * Claims one turn. Returns the new count, or NULL when the cap is already
 * reached.
 *
 * Atomic on purpose: two turns posted together would both read N and both
 * write N+1 under a read-then-write, and the cap would leak. The SQL
 * function does it in one statement.
 */
export async function claimConciergeTurn(
  db: SupabaseClient, conversationId: string, max: number,
): Promise<number | null> {
  const { data, error } = await db.rpc("concierge_claim_turn", {
    p_conversation_id: conversationId, p_max: max,
  });
  if (error) throw new Error(`claimConciergeTurn failed: ${error.message}`);
  return (data as number | null) ?? null;
}

/**
 * Appends to the stored transcript. Read-modify-write is acceptable here and
 * nowhere else in this module: turns within ONE conversation are serialized
 * by `claimConciergeTurn`, which has already refused the concurrent second
 * turn before this is ever reached.
 */
export async function appendConciergeTurns(
  db: SupabaseClient, conversationId: string, turns: ConciergeTurn[],
): Promise<void> {
  const current = await getConciergeConversation(db, conversationId);
  if (!current) throw new Error("appendConciergeTurns failed: conversation not found");
  const { error } = await db.from("concierge_conversations")
    .update({ transcript: [...current.transcript, ...turns] })
    .eq("id", conversationId);
  if (error) throw new Error(`appendConciergeTurns failed: ${error.message}`);
}

/** Records the one submission this conversation produced. The `is` filter is
 *  the guard: a second capture_lead finds no row to update and writes
 *  nothing, so one visitor can never become two leads. */
export async function setConciergeSubmission(
  db: SupabaseClient, conversationId: string, submissionId: string,
): Promise<void> {
  const { error } = await db.from("concierge_conversations")
    .update({ submission_id: submissionId })
    .eq("id", conversationId).is("submission_id", null);
  if (error) throw new Error(`setConciergeSubmission failed: ${error.message}`);
}

/** Conversations STARTED by this hashed IP since `sinceIso`. */
export async function countConciergeConversationsByIp(
  db: SupabaseClient, ipHash: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("concierge_conversations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", sinceIso);
  if (error) throw new Error(`countConciergeConversationsByIp failed: ${error.message}`);
  return count ?? 0;
}

/** Conversations started against this account since `sinceIso`. The
 *  per-tenant ceiling: one client's public page must not spend alone. */
export async function countConciergeConversationsForAccount(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("concierge_conversations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("created_at", sinceIso);
  if (error) throw new Error(`countConciergeConversationsForAccount failed: ${error.message}`);
  return count ?? 0;
}
