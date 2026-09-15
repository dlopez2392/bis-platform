import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkSource = "task" | "conversation" | "booking";

export type WorkRow = {
  id: string;
  source: WorkSource;
  accountId: string;
  contactId: string | null;
  title: string;
  dueAt: string | null;
  occurredAt: string;
};

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

/**
 * There is deliberately no separate "unreturned call" source any more. The
 * platform's own missed-call text-back writes an outbound message seconds
 * after a call ends (finish-call.ts:388-390), and `createMessage` persists no
 * author on `messages` — so a rule keyed on "any outbound message follows the
 * call" could never tell our own send apart from a human's. `finishCall`
 * already writes the call's summary as an INBOUND message and bumps
 * `unread_count` for any meaningful outcome (finish-call.ts:226-237), so the
 * conversation row IS the truer signal, with clearing semantics that already
 * work. `title` here carries that call's summary when one exists, so the
 * queue still shows what the call was about — ONE extra account-scoped read
 * for the whole batch, never one per row.
 */
async function unansweredConversations(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const { data, error } = await db.from("conversations")
    .select("id, contact_id, unread_count, last_message_at")
    .eq("account_id", accountId).gt("unread_count", 0)
    .order("last_message_at", { ascending: true }).limit(200);
  if (error) throw new Error(`unansweredConversations failed: ${error.message}`);
  const convos = data ?? [];
  if (convos.length === 0) return [];

  const ids = convos.map((c) => c.id);
  const { data: calls, error: cErr } = await db.from("calls")
    .select("conversation_id, summary, started_at")
    .eq("account_id", accountId).in("conversation_id", ids);
  if (cErr) throw new Error(`unansweredConversations calls read failed: ${cErr.message}`);

  // Latest call per conversation, picked in memory rather than with a second
  // per-row query.
  const latestByConvo = new Map<string, { summary: string; startedAt: string }>();
  for (const row of (calls ?? []) as
       { conversation_id: string | null; summary: string; started_at: string }[]) {
    if (!row.conversation_id) continue;
    const prev = latestByConvo.get(row.conversation_id);
    if (!prev || row.started_at > prev.startedAt) {
      latestByConvo.set(row.conversation_id, { summary: row.summary, startedAt: row.started_at });
    }
  }

  return convos.map((c) => ({
    id: `conversation:${c.id}`, source: "conversation" as const, accountId,
    contactId: c.contact_id, title: latestByConvo.get(c.id)?.summary ?? "",
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
 * derived conversation row, so a "Not now" dismissal does not leave the
 * original showing alongside the task it created. Bookings are exempt —
 * marking one changes `status`, so it stops matching on its own.
 */
export async function listAccountWork(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const [tasks, convos, bookings] = await Promise.all([
    openTasks(db, accountId),
    unansweredConversations(db, accountId),
    staleBookings(db, accountId),
  ]);
  const suppressed = new Set(tasks.map((t) => t.contactId).filter(Boolean) as string[]);
  const keep = (r: WorkRow) => !r.contactId || !suppressed.has(r.contactId);
  return [...tasks, ...convos.filter(keep), ...bookings];
}

/** `listAgencyWork`'s own row shape: every `WorkRow` field plus the two the
 *  agency-wide screen needs and a per-account row does not — `brandName`
 *  (never `accounts.name`, see below) and `timezone`, so the zone a row's
 *  own bucket depends on travels WITH the row rather than requiring a
 *  second, separate account read to look it up (Work Queue Task 6). */
export type AgencyWorkRow = WorkRow & { brandName: string; timezone: string };

export async function listAgencyWork(
  db: SupabaseClient,
): Promise<AgencyWorkRow[]> {
  const { data, error } = await db.from("accounts")
    .select("id, brand_name, name, timezone").eq("outbound_suppressed", false);
  if (error) throw new Error(`listAgencyWork accounts read failed: ${error.message}`);
  const out: AgencyWorkRow[] = [];
  for (const a of data ?? []) {
    // brand_name, never name — the internal label has leaked to customers.
    const brandName = a.brand_name ?? "";
    const rows = await listAccountWork(db, a.id);
    for (const r of rows) out.push({ ...r, brandName, timezone: a.timezone });
  }
  return out;
}
