import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

/**
 * F-072, after the job: the customer's one-tap answer to "How did we do?" (migration job_checkins;
 * docs/superpowers/plans/2026-11-17-review-requests.md, D1 to D3 and D8).
 *
 * SERVICE CLIENT ONLY. Every write here is service_role's (the table grants no client write), and the public page
 * that calls them is scoped by its signed token's account, so every function takes the account and filters on it.
 * A row exists only once the customer answered; "asked" is `bookings.review_requested_at`, never a row here.
 * Every function THROWS on a database error rather than answering a default.
 */

export const CHECKIN_ANSWERS = ["great", "okay", "not_great"] as const;
export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number];

export type JobCheckin = {
  id: string; accountId: string; bookingId: string; contactId: string;
  answer: CheckinAnswer; answeredAt: string; reviewLinkOpenedAt: string | null;
};

type Row = {
  id: string; account_id: string; booking_id: string; contact_id: string;
  answer: CheckinAnswer; answered_at: string; review_link_opened_at: string | null;
};
const COLS = "id, account_id, booking_id, contact_id, answer, answered_at, review_link_opened_at";
const toCheckin = (r: Row): JobCheckin => ({
  id: r.id, accountId: r.account_id, bookingId: r.booking_id, contactId: r.contact_id,
  answer: r.answer, answeredAt: r.answered_at, reviewLinkOpenedAt: r.review_link_opened_at,
});

export type RecordCheckinResult =
  | { status: "recorded"; checkin: JobCheckin }
  /** Someone answered first (a second tap, a double submit, a replay): nothing was written; `checkin` is theirs. */
  | { status: "already"; checkin: JobCheckin }
  /** No COMPLETED booking with this id in this account: deleted, never completed, reverted, or another account's. */
  | { status: "gone" };

/** The answer for this booking, or null when nobody has answered. */
export async function getCheckinForBooking(db: SupabaseClient, accountId: string, bookingId: string): Promise<JobCheckin | null> {
  const { data, error } = await db.from("job_checkins").select(COLS)
    .eq("account_id", accountId).eq("booking_id", bookingId).maybeSingle();
  if (error) throw new Error(`getCheckinForBooking failed: ${error.message}`);
  return data ? toCheckin(data as Row) : null;
}

/**
 * Records the customer's answer ONCE (plan D1, owner answer Q7: the first answer wins). The contact is never taken
 * from the caller: it is read from the booking itself, which must be this account's and completed (D2). The insert
 * is `on conflict (booking_id) do nothing` (PostgREST's ignore-duplicates), so of any number of concurrent answers
 * exactly one is "recorded" and the rest are "already", each told the winner's answer.
 */
export async function recordCheckinAnswer(
  db: SupabaseClient, accountId: string, bookingId: string, answer: CheckinAnswer,
): Promise<RecordCheckinResult> {
  if (!(CHECKIN_ANSWERS as readonly string[]).includes(answer)) {
    throw new Error(`recordCheckinAnswer: not an answer: ${JSON.stringify(answer)}`);
  }
  const { data: booking, error: readErr } = await db.from("bookings").select("contact_id")
    .eq("account_id", accountId).eq("id", bookingId).eq("status", "completed").maybeSingle();
  if (readErr) throw new Error(`recordCheckinAnswer booking read failed: ${readErr.message}`);
  if (!booking) return { status: "gone" };

  const { data, error } = await db.from("job_checkins")
    .upsert({ account_id: accountId, booking_id: bookingId, contact_id: (booking as { contact_id: string }).contact_id, answer },
      { onConflict: "booking_id", ignoreDuplicates: true })
    .select(COLS);
  if (error) throw new Error(`recordCheckinAnswer failed: ${error.message}`);
  const won = (data ?? []) as Row[];
  if (won.length === 1) return { status: "recorded", checkin: toCheckin(won[0]!) };

  const first = await getCheckinForBooking(db, accountId, bookingId);
  if (!first) throw new Error("recordCheckinAnswer: the insert yielded to an answer that cannot be read");
  return { status: "already", checkin: first };
}

/**
 * The customer pressed the review button (plan D1): stamps `review_link_opened_at` on the FIRST press only.
 * True when this call stamped it; false when it was already stamped or nobody has answered (no row).
 */
export async function markReviewLinkOpened(db: SupabaseClient, accountId: string, bookingId: string): Promise<boolean> {
  const { data, error } = await db.from("job_checkins").update({ review_link_opened_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("booking_id", bookingId).is("review_link_opened_at", null).select("id");
  if (error) throw new Error(`markReviewLinkOpened failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The ONE To-do a "not great" answer opens (plan D3), on the check-in's own customer, linked by
 * `tasks.review_checkin_id` (unique: tasks_review_checkin_once). `ensureDocumentExpiryTask`'s shape: insert, and a
 * 23505 means it is already there, so any number of calls make one To-do; task.created is emitted only by the call
 * that made it. Refuses any other answer, before a write. The title is the caller's (bilingual copy lives in web).
 */
export async function ensureCheckinTask(
  db: SupabaseClient, accountId: string, checkin: JobCheckin, input: { title: string; dueAt: string },
  actorId: string, actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  if (checkin.answer !== "not_great") throw new Error(`ensureCheckinTask: a To-do is only for not_great, not ${checkin.answer}`);
  const { data, error } = await db.from("tasks").insert({
    account_id: accountId, contact_id: checkin.contactId, title: input.title, due_at: input.dueAt, review_checkin_id: checkin.id,
  }).select("id").single();
  if (!error && data) {
    const id = (data as { id: string }).id;
    await emit(db, accountId, "task.created", actorId, { taskId: id, contactId: checkin.contactId, checkinId: checkin.id }, actorType);
    return { id, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureCheckinTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks").select("id")
    .eq("account_id", accountId).eq("review_checkin_id", checkin.id).maybeSingle();
  if (readErr || !found) throw new Error(`ensureCheckinTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}

export type CheckinCounts = { asked: number; answered: number; great: number; okay: number; notGreat: number; opened: number };

/**
 * The settings card's line (plan D8), since `sinceIso`: asked (review requests stamped, `bookings.review_requested_at`),
 * answered, each answer, and how many pressed the review button. Never who left a review: that cannot be known.
 * Head counts; a null count THROWS (a failure must not read as zero).
 */
export async function checkinCounts(db: SupabaseClient, accountId: string, sinceIso: string): Promise<CheckinCounts> {
  const count = async (what: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error(`checkinCounts ${what} failed: ${error.message}`);
    if (n === null) throw new Error(`checkinCounts ${what} failed: no count returned`);
    return n;
  };
  const answers = () => db.from("job_checkins").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("answered_at", sinceIso);
  const [asked, answered, great, okay, notGreat, opened] = await Promise.all([
    count("asked", db.from("bookings").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).gte("review_requested_at", sinceIso)),
    count("answered", answers()),
    count("great", answers().eq("answer", "great")),
    count("okay", answers().eq("answer", "okay")),
    count("not_great", answers().eq("answer", "not_great")),
    count("opened", db.from("job_checkins").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).gte("review_link_opened_at", sinceIso)),
  ]);
  return { asked, answered, great, okay, notGreat, opened };
}
