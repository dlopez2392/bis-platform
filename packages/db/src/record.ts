import type { SupabaseClient } from "@supabase/supabase-js";
import { countContactBookingsMade, listContactUpcomingBookings, type UpcomingBooking } from "./booking";
import { listContactCalls } from "./voice";

/**
 * The contact record page's checked facts and "Next up" (S-03 part 1, 1a; spec §7). Bounded reads
 * only: exact head counts, one-row reads, open deals up to the cap and Next up up to its limit;
 * never an unbounded list. Every read runs on the caller's client, so RLS (0068's Technician
 * fences included) decides what is counted; there is no role branch here. A count the server did
 * not return is a failed read, never a zero: postgrest-js turns a HEAD request's empty 404 into
 * `{ error: null, count: null }` (status 204), so `count ?? 0` would report a failure as "none".
 */
export type Fact<T> = { ok: true; value: T } | { ok: false };
export type LastTalkedChannel = "text" | "email" | "call";
export type LastTalked = { at: string; channel: LastTalkedChannel };
export type OpenDeals = { count: number; amount: number | null };
export type ContactFacts = { bookingsMade: Fact<number>; lastTalked: Fact<LastTalked | null>; openDeals: Fact<OpenDeals> };
export type FactName = "bookings" | "talked" | "deals";
/** Past this many open deals the summary leaves the amount out rather than understate it. */
export const OPEN_DEALS_SUM_CAP = 100;

async function settle<T>(name: FactName, read: () => Promise<T>, onError?: (name: FactName, e: unknown) => void): Promise<Fact<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (e) {
    onError?.(name, e);
    return { ok: false };
  }
}

/** The newest email or text with this customer that did not fail. `form` and `voice` rows are the
 *  inbox's copies of a submission, a booking change or a call (spec C4); they are not talking. */
async function newestConversationMessage(db: SupabaseClient, accountId: string, contactId: string): Promise<LastTalked | null> {
  const { data: convo, error } = await db.from("conversations").select("id")
    .eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`newestConversationMessage failed: ${error.message}`);
  if (!convo) return null;
  const { data, error: mErr } = await db.from("messages").select("channel, created_at")
    .eq("account_id", accountId).eq("conversation_id", (convo as { id: string }).id)
    .in("channel", ["email", "sms"]).not("status", "in", "(failed,bounced)")
    .order("created_at", { ascending: false }).limit(1);
  if (mErr) throw new Error(`newestConversationMessage failed: ${mErr.message}`);
  const row = ((data ?? []) as { channel: "email" | "sms"; created_at: string }[])[0];
  return row ? { at: row.created_at, channel: row.channel === "sms" ? "text" : "email" } : null;
}

async function lastTalked(db: SupabaseClient, accountId: string, contactId: string): Promise<LastTalked | null> {
  const [message, calls] = await Promise.all([
    newestConversationMessage(db, accountId, contactId),
    listContactCalls(db, accountId, contactId, 1, { excludeSpam: true }),
  ]);
  const call: LastTalked | null = calls[0] ? { at: calls[0].started_at, channel: "call" } : null;
  if (!message) return call;
  if (!call) return message;
  return Date.parse(call.at) > Date.parse(message.at) ? call : message;
}

async function openDeals(db: SupabaseClient, accountId: string, contactId: string, cap: number): Promise<OpenDeals> {
  const { data, count, error } = await db.from("opportunities").select("monetary_value", { count: "exact" })
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "open")
    .order("id", { ascending: true }).limit(cap);
  if (error) throw new Error(`openDeals failed: ${error.message}`);
  // Fail closed: without the exact count, the rows (at most `cap`) could understate it.
  if (count === null) throw new Error("openDeals failed: no exact count returned");
  const rows = (data ?? []) as { monetary_value: number | string }[];
  if (count > rows.length) return { count, amount: null };
  // monetary_value is numeric(12,2): summing whole cents keeps 0.10 + 0.20 at 0.3.
  const cents = rows.reduce((sum, r) => sum + Math.round(Number(r.monetary_value) * 100), 0);
  return { count, amount: cents / 100 };
}

/** Never throws: a failed read is that fact's `{ ok: false }`, named to `onError` for the log. */
export async function contactFacts(
  db: SupabaseClient, accountId: string, contactId: string,
  opts: { onError?: (name: FactName, e: unknown) => void; openDealsCap?: number } = {},
): Promise<ContactFacts> {
  const cap = opts.openDealsCap ?? OPEN_DEALS_SUM_CAP;
  const [bookingsMade, talked, deals] = await Promise.all([
    settle("bookings", () => countContactBookingsMade(db, accountId, contactId), opts.onError),
    settle("talked", () => lastTalked(db, accountId, contactId), opts.onError),
    settle("deals", () => openDeals(db, accountId, contactId, cap), opts.onError),
  ]);
  return { bookingsMade, lastTalked: talked, openDeals: deals };
}

export type NextUpTask = { id: string; title: string; due_at: string };
export type ContactNextUp = { bookings: UpcomingBooking[]; datedTasks: NextUpTask[]; undatedCount: number };

/**
 * "Next up" (spec §9.3, C9): bookings still ahead, open To-dos WITH a due date (overdue ones sort
 * first because they are earliest), and a head count of open To-dos with none. An undated To-do has
 * no "next" to sort by, so it is counted, never listed. THROWS on a read error.
 */
export async function contactNextUp(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string, limit = 3,
): Promise<ContactNextUp> {
  const [bookings, dated, undated] = await Promise.all([
    listContactUpcomingBookings(db, accountId, contactId, nowIso, limit),
    db.from("tasks").select("id, title, due_at")
      .eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).not("due_at", "is", null)
      .order("due_at", { ascending: true }).order("id", { ascending: true }).limit(limit),
    db.from("tasks").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).is("due_at", null),
  ]);
  if (dated.error) throw new Error(`contactNextUp To-dos failed: ${dated.error.message}`);
  if (undated.error) throw new Error(`contactNextUp undated count failed: ${undated.error.message}`);
  if (undated.count === null) throw new Error("contactNextUp undated count failed: no count returned");
  return { bookings, datedTasks: (dated.data ?? []) as NextUpTask[], undatedCount: undated.count };
}
