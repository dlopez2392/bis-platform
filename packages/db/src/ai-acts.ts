import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import { parseAiAct, type AiAct, type NewAiAct } from "./ai-act-rules";

/**
 * One table for every act Sofia or the web chat takes live (0091, item 8c). Every read and write is
 * scoped by `account_id`. `insertAiActs` runs on the SERVICE client only (0091 grants no client
 * write). The RPC wrappers (`undoAiBookingAct`, `aiContactHeldBy`, `undoAiContactCreated`) each wrap
 * one of 0091's three functions, which hold their own still-safe check and write in ONE transaction;
 * events stay this file's own, written AFTER the RPC's answer, exactly as `moveBooking`'s own
 * best-effort emit is (booking.ts).
 */

const COLS = "id, account_id, actor, call_id, chat_id, contact_id, kind, target, before, after, undone_at, undone_by, undo_notified, created_at";

type Row = {
  id: string; account_id: string; actor: string; call_id: string | null; chat_id: string | null;
  contact_id: string; kind: string; target: unknown; before: unknown; after: unknown;
  undone_at: string | null; undone_by: string | null; undo_notified: boolean; created_at: string;
};

function toRow(accountId: string, a: NewAiAct) {
  return {
    account_id: accountId, actor: a.actor, call_id: a.callId, chat_id: a.chatId, contact_id: a.contactId,
    kind: a.kind, target: a.target, before: a.before, after: a.after,
  };
}

/** Writes every act, ONE multi-row insert (Task 4 collects a site's acts and calls this once). THROWS
 *  on a database error: the caller (`apps/web/src/lib/ai-acts/record.ts`) never lets this throw reach
 *  the live call. A no-op on an empty list. */
export async function insertAiActs(db: SupabaseClient, accountId: string, acts: readonly NewAiAct[]): Promise<void> {
  if (acts.length === 0) return;
  const { error } = await db.from("ai_acts").insert(acts.map((a) => toRow(accountId, a)));
  if (error) throw new Error(`insertAiActs failed: ${error.message}`);
}

/** One act, or null (not found, or another account's). On the REQUEST client, RLS decides what a
 *  Technician may read. THROWS on a database error. */
export async function getAiAct(db: SupabaseClient, accountId: string, id: string): Promise<AiAct | null> {
  const { data, error } = await db.from("ai_acts").select(COLS)
    .eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`getAiAct failed: ${error.message}`);
  return data ? parseAiAct(data as unknown as Row) : null;
}

/** The record's timeline source (`record.ts`'s `ai_acts`): one person or a household's set, paged
 *  newest first. An unparseable row is dropped and logged by id, never thrown, so one bad row never
 *  takes the page down. THROWS on a database error. */
export async function listContactAiActs(
  db: SupabaseClient, accountId: string, who: string | readonly string[], page: TimelinePageOpts,
): Promise<AiAct[]> {
  const { data, error } = await withTimelinePage(
    forContacts(db.from("ai_acts").select(COLS).eq("account_id", accountId), "contact_id", who),
    "created_at", page);
  if (error) throw new Error(`listContactAiActs failed: ${error.message}`);
  const out: AiAct[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const act = parseAiAct(r);
    if (act) out.push(act);
    else console.error(`listContactAiActs: skipped ai_act ${r.id}: payload does not fit kind ${r.kind}`);
  }
  return out;
}

/** An event written AFTER the RPC's own write has already committed, where the booking row is the
 *  truth (`moveBooking`'s rule, booking.ts): a failure here is logged, never thrown — it would
 *  misreport a database write that actually succeeded. */
async function emitLogged(db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object, actorType: ActorType): Promise<void> {
  try {
    await emit(db, accountId, type, actorId, payload, actorType);
  } catch (e) {
    console.error(`ai-acts: ${type} event not recorded for account ${accountId}: ${String(e)}`);
  }
}

export type AiBookingUndoOutcome =
  | "undone" | "already_undone" | "gone" | "already_cancelled" | "already_happened"
  | "rebooked" | "time_passed" | "time_taken" | "old_time_taken" | "changed";

/**
 * Undo of one of Sofia's booking acts (0091's `undo_ai_booking_act`, SERVICE client only — the app
 * proves the booking on the request client first, in `apps/web`'s undo handlers). Reads the act
 * first (what never changes after insert) so it knows what to emit; calls the RPC; emits
 * `booking.status_changed` ONLY on `"undone"`, for each booking the function actually moved — never
 * unconditionally, and never before the RPC answers (the CAS's own outcome is the only truth that a
 * moved booking happened at all).
 */
export async function undoAiBookingAct(
  db: SupabaseClient, accountId: string, actId: string, by: string, now: Date,
): Promise<AiBookingUndoOutcome> {
  const act = await getAiAct(db, accountId, actId);
  const { data, error } = await db.rpc("undo_ai_booking_act", {
    p_account_id: accountId, p_act_id: actId, p_by: by, p_now: now.toISOString(),
  });
  if (error) throw new Error(`undoAiBookingAct failed: ${error.message}`);
  const outcome = data as AiBookingUndoOutcome;
  if (outcome === "undone" && act) {
    if (act.kind === "booking_created") {
      await emitLogged(db, accountId, "booking.status_changed", by, { bookingId: act.target.bookingId, status: "cancelled" }, "user");
    } else if (act.kind === "booking_cancelled") {
      await emitLogged(db, accountId, "booking.status_changed", by, { bookingId: act.target.bookingId, status: "booked" }, "user");
    } else if (act.kind === "booking_rescheduled") {
      // The new booking was DELETED, not cancelled (0091's own reason); only the restored old booking
      // is a status change worth an event. The deleted row's record is its own act, stamped undone.
      await emitLogged(db, accountId, "booking.status_changed", by, { bookingId: act.target.fromBookingId, status: "booked" }, "user");
    }
  }
  return outcome;
}

/** What holds a contact Sofia created (0091's `ai_contact_held_by`): the names of the tables holding
 *  anything that is NOT her own call or chat. Empty means safe to delete. On the request client (a
 *  display read, RLS-scoped) or the service client (the authoritative pre-delete check). THROWS on a
 *  database error or a non-`contact_created` act. */
export async function aiContactHeldBy(db: SupabaseClient, accountId: string, actId: string): Promise<string[]> {
  const { data, error } = await db.rpc("ai_contact_held_by", { p_account_id: accountId, p_act_id: actId });
  if (error) throw new Error(`aiContactHeldBy failed: ${error.message}`);
  return (data ?? []) as string[];
}

export type AiContactUndoOutcome = "deleted" | "has_activity" | "has_booking" | "gone";

/** Undo of a contact Sofia created (0091's `undo_ai_contact_created`, SERVICE client only). Answers
 *  what happened; the call stays in Calls, unlinked, on `"deleted"` (D4). THROWS on a database error. */
export async function undoAiContactCreated(db: SupabaseClient, accountId: string, actId: string): Promise<AiContactUndoOutcome> {
  const { data, error } = await db.rpc("undo_ai_contact_created", { p_account_id: accountId, p_act_id: actId });
  if (error) throw new Error(`undoAiContactCreated failed: ${error.message}`);
  return data as AiContactUndoOutcome;
}

/** Stamps an act undone (`undone_at is null` is the compare-and-swap): true when this call actually
 *  moved it, false when another stamp (or an undo RPC) already had. THROWS on a database error. */
export async function stampAiActUndone(db: SupabaseClient, accountId: string, actId: string, by: string, at: Date): Promise<boolean> {
  const { data, error } = await db.from("ai_acts")
    .update({ undone_at: at.toISOString(), undone_by: by })
    .eq("account_id", accountId).eq("id", actId).is("undone_at", null)
    .select("id");
  if (error) throw new Error(`stampAiActUndone failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The field redo: gives a field-fill act back its un-undone state, only while it is still THIS
 *  undoer's own stamp at that exact instant (a compare-and-swap, same shape as `revertProposalDecision`).
 *  THROWS on a database error. */
export async function clearAiActUndone(db: SupabaseClient, accountId: string, actId: string, by: string, at: Date): Promise<boolean> {
  const { data, error } = await db.from("ai_acts")
    .update({ undone_at: null, undone_by: null })
    .eq("account_id", accountId).eq("id", actId).eq("undone_by", by).eq("undone_at", at.toISOString())
    .select("id");
  if (error) throw new Error(`clearAiActUndone failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Marks an undone act's customer notice as sent (or deliberately not sent); a no-op past the pair
 *  CHECK's own guard (0091: `undo_notified` only true once `undone_at` is set). THROWS on a database
 *  error. */
export async function markAiActNotified(db: SupabaseClient, accountId: string, actId: string): Promise<void> {
  const { error } = await db.from("ai_acts").update({ undo_notified: true })
    .eq("account_id", accountId).eq("id", actId);
  if (error) throw new Error(`markAiActNotified failed: ${error.message}`);
}
