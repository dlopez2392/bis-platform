import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkSource = "task" | "call" | "conversation" | "booking";

export type WorkRow = {
  id: string;
  source: WorkSource;
  accountId: string;
  contactId: string | null;
  title: string;
  dueAt: string | null;
  occurredAt: string;
};

/** Calls that need returning. `booked` and `spam` need nothing; `abandoned` is
 *  DELIBERATELY excluded (spec §1.2) — a hang-up is usually a wrong number,
 *  and flooding the queue is how a queue loses its reader. Widening this is a
 *  product decision, not a fix. */
const NEEDS_RETURN = ["lead", "message"] as const;

async function openTasks(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  // Uses the partial index tasks_account_open (account_id) where completed_at is null.
  const { data, error } = await db.from("tasks")
    .select("id, contact_id, title, due_at, created_at")
    .eq("account_id", accountId).is("completed_at", null);
  if (error) throw new Error(`openTasks failed: ${error.message}`);
  return (data ?? []).map((t) => ({
    id: `task:${t.id}`, source: "task" as const, accountId,
    contactId: t.contact_id, title: t.title,
    dueAt: t.due_at, occurredAt: t.created_at,
  }));
}

async function unreturnedCalls(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const { data, error } = await db.from("calls")
    .select("id, contact_id, started_at, summary")
    .eq("account_id", accountId).in("outcome", NEEDS_RETURN as unknown as string[])
    .not("contact_id", "is", null)
    .order("started_at", { ascending: true }).limit(200);
  if (error) throw new Error(`unreturnedCalls failed: ${error.message}`);
  const calls = data ?? [];
  if (calls.length === 0) return [];

  // "Returned" = any OUTBOUND message on that contact after the call. One read
  // for every candidate contact rather than one per call.
  const contactIds = [...new Set(calls.map((c) => c.contact_id as string))];
  const { data: outbound, error: mErr } = await db.from("messages")
    .select("created_at, conversations!inner(contact_id)")
    .eq("direction", "outbound")
    .in("conversations.contact_id", contactIds);
  if (mErr) throw new Error(`unreturnedCalls outbound read failed: ${mErr.message}`);

  const latestOut = new Map<string, string>();
  for (const row of (outbound ?? []) as unknown as
       { created_at: string; conversations: { contact_id: string } }[]) {
    const cid = row.conversations.contact_id;
    const prev = latestOut.get(cid);
    if (!prev || row.created_at > prev) latestOut.set(cid, row.created_at);
  }

  return calls
    .filter((c) => {
      const out = latestOut.get(c.contact_id as string);
      return !out || out <= c.started_at;
    })
    .map((c) => ({
      id: `call:${c.id}`, source: "call" as const, accountId,
      contactId: c.contact_id, title: c.summary || "",
      dueAt: null, occurredAt: c.started_at,
    }));
}

async function unansweredConversations(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const { data, error } = await db.from("conversations")
    .select("id, contact_id, unread_count, last_message_at")
    .eq("account_id", accountId).gt("unread_count", 0)
    .order("last_message_at", { ascending: true }).limit(200);
  if (error) throw new Error(`unansweredConversations failed: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: `conversation:${c.id}`, source: "conversation" as const, accountId,
    contactId: c.contact_id, title: "",
    dueAt: null, occurredAt: c.last_message_at ?? new Date(0).toISOString(),
  }));
}

async function staleBookings(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  // A job whose time has passed and which nobody marked completed or no_show.
  // This is the row that switches the review-request automation back on.
  const { data, error } = await db.from("bookings")
    .select("id, contact_id, ends_at")
    .eq("account_id", accountId).eq("status", "booked")
    .lt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: true }).limit(200);
  if (error) throw new Error(`staleBookings failed: ${error.message}`);
  return (data ?? []).map((b) => ({
    id: `booking:${b.id}`, source: "booking" as const, accountId,
    contactId: b.contact_id, title: "",
    dueAt: null, occurredAt: b.ends_at,
  }));
}

/**
 * SUPPRESSION (spec §3): an open task against a contact hides that contact's
 * derived call and conversation rows, so a "Not now" dismissal does not leave
 * the original showing alongside the task it created. Bookings are exempt —
 * marking one changes `status`, so it stops matching on its own.
 */
export async function listAccountWork(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const [tasks, calls, convos, bookings] = await Promise.all([
    openTasks(db, accountId),
    unreturnedCalls(db, accountId),
    unansweredConversations(db, accountId),
    staleBookings(db, accountId),
  ]);
  const suppressed = new Set(tasks.map((t) => t.contactId).filter(Boolean) as string[]);
  const keep = (r: WorkRow) => !r.contactId || !suppressed.has(r.contactId);
  return [...tasks, ...calls.filter(keep), ...convos.filter(keep), ...bookings];
}

export async function listAgencyWork(
  db: SupabaseClient,
): Promise<(WorkRow & { brandName: string })[]> {
  const { data, error } = await db.from("accounts")
    .select("id, brand_name, name").eq("outbound_suppressed", false);
  if (error) throw new Error(`listAgencyWork accounts read failed: ${error.message}`);
  const out: (WorkRow & { brandName: string })[] = [];
  for (const a of data ?? []) {
    // brand_name, never name — the internal label has leaked to customers.
    const brandName = a.brand_name ?? "";
    const rows = await listAccountWork(db, a.id);
    for (const r of rows) out.push({ ...r, brandName });
  }
  return out;
}
