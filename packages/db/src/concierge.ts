import type { SupabaseClient } from "@supabase/supabase-js";
import { newPublicId } from "./forms";
import { PROFILE_COLS, type VoiceProfileRow } from "./voice";

/** One side of one exchange. Same shape as `calls.transcript`'s
 *  TranscriptEvent, so one reader renders both. */
export type ConciergeTurn = { role: "visitor" | "assistant"; text: string; at: string };

export type ConciergeProfile = VoiceProfileRow & {
  public_id: string; concierge_form_id: string;
};

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
    .select(PROFILE_COLS)
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
 * Calls `concierge_enable` (0044), which does
 * `coalesce(public_id, p_new_public_id)` and `returning public_id` IN ONE
 * STATEMENT. The public id is minted ONCE and kept: re-enabling after a
 * disable must not change the address, or every snippet already pasted on a
 * client's website silently stops working.
 *
 * The old shape read the current value, minted a replacement in JS when it
 * was null, wrote it, and returned ITS OWN MINT rather than what the row
 * ended up holding. Two concurrent enables (a double-clicked toggle) both
 * read null, mint two different ids, and both update the same row — each
 * caller is handed its own id while the row keeps only the later one, and
 * the snippet rendered from the losing response points at a `/c/<publicId>`
 * that resolves to nothing, forever, with no error on any surface. The
 * unique index cannot catch it because both statements target the same row.
 * `newPublicId()` is still called here, unconditionally, on every call —
 * that mint is thrown away by `coalesce` whenever the row already has one,
 * and is exactly the value the row ends up with when it does not.
 *
 * `data` is null when the account has no `voice_profiles` row, which is a
 * real state — an account that has never saved voice settings has no
 * profile to attach a concierge to — so that is reported as a named error,
 * not a success that quietly wrote nothing.
 */
export async function enableConcierge(
  db: SupabaseClient, accountId: string, formId: string,
): Promise<{ publicId: string }> {
  const { data, error } = await db.rpc("concierge_enable", {
    p_account_id: accountId, p_form_id: formId, p_new_public_id: newPublicId(),
  });
  if (error) throw new Error(`enableConcierge failed: ${error.message}`);
  if (!data) throw new Error("enableConcierge failed: no voice profile for this account");
  return { publicId: data as string };
}

/**
 * Switches it off WITHOUT clearing `public_id` -- see enableConcierge.
 *
 * `.select("id")` and a zero-row check, the `setPhoneNumberTelnyxId`
 * precedent (`voice.ts`): PostgREST reports an UPDATE that matched nothing
 * as a success with no rows, and a caller that only checks `.error` cannot
 * tell that apart from actually having switched something off.
 */
export async function disableConcierge(
  db: SupabaseClient, accountId: string,
): Promise<void> {
  const { data, error } = await db.from("voice_profiles")
    .update({ concierge_enabled: false }).eq("account_id", accountId).select("id");
  if (error) throw new Error(`disableConcierge failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("disableConcierge matched no row");
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
  // The fallback covers `!data && !error` -- an insert that reports success
  // with no row and no error would otherwise render as "failed: undefined".
  if (error || !data) {
    throw new Error(`createConciergeConversation failed: ${error?.message ?? "insert returned no row"}`);
  }
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
 *
 * NULL is deliberately ambiguous between "cap reached" and "no such
 * conversation" -- both are the SQL function's `where … returning` matching
 * zero rows, and there is no third value to distinguish them with. That is
 * the fail-closed direction (a caller that cannot tell the two apart still
 * refuses either way), so it stays, but Task 4's visitor-facing copy must
 * say something a real person can act on for a bogus id too -- "this
 * conversation is over" reads fine for both cases; a message specific to
 * "the cap is reached" would be a lie for the other one.
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
 * Appends to the stored transcript. Calls `concierge_append_turns` (0044),
 * which does `transcript = transcript || p_turns` in ONE statement, and
 * returns the new array length so a caller can tell an append from a
 * replace without a second round trip.
 *
 * This used to be read-modify-write on the claim that `claimConciergeTurn`
 * had already serialised turns within one conversation. THAT WAS FALSE at
 * every cap above 1: the claim refuses only at `turn_count >= p_max`, so
 * below the cap two concurrent POSTs both succeed (the second blocks on the
 * row lock, re-reads e.g. `1 < 24`, and returns 2), both then read the same
 * transcript here, and the later write replaces the earlier one — an
 * exchange vanishes with no error anywhere. The prior test only passed
 * because it used `max = 1`, the single cap value at which the claim happens
 * to hold. The transcript IS the lead's record; losing a turn silently is
 * the exact failure this table exists to prevent.
 */
export async function appendConciergeTurns(
  db: SupabaseClient, conversationId: string, turns: ConciergeTurn[],
): Promise<number> {
  const { data, error } = await db.rpc("concierge_append_turns", {
    p_conversation_id: conversationId, p_turns: turns,
  });
  if (error) throw new Error(`appendConciergeTurns failed: ${error.message}`);
  if (data === null) throw new Error("appendConciergeTurns failed: conversation not found");
  return data as number;
}

/**
 * Records the one submission this conversation produced. The `is` filter is
 * the guard: a second capture_lead finds no row to update and writes
 * nothing, so one visitor can never become two leads.
 *
 * Returns `true` when THIS call claimed the slot, `false` when the
 * conversation exists but a submission was already recorded on it (the
 * `is("submission_id", null)` filter matched nothing because it was already
 * non-null — a real, expected state, not an error). Throws only when the
 * conversation itself does not exist. A bare `.error` check could not tell
 * "already claimed" from "no such row" from "it worked" — all three looked
 * like success.
 */
export async function setConciergeSubmission(
  db: SupabaseClient, conversationId: string, submissionId: string,
): Promise<boolean> {
  const { data, error } = await db.from("concierge_conversations")
    .update({ submission_id: submissionId })
    .eq("id", conversationId).is("submission_id", null)
    .select("id");
  if (error) throw new Error(`setConciergeSubmission failed: ${error.message}`);
  if (data && data.length > 0) return true;
  const existing = await getConciergeConversation(db, conversationId);
  if (!existing) throw new Error("setConciergeSubmission failed: conversation not found");
  return false;
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
