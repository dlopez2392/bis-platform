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
  // The only one of the three sources with no cap until this line — the
  // other two (below) both order-then-limit(200); oldest-first here matches
  // their own ascending order and this screen's general oldest-first bias
  // (spec §2's Waiting bucket), and bucketWork re-sorts everything by its
  // own due/occurred date regardless, so this only decides WHICH 200 make
  // the cut when an account somehow has more open tasks than that.
  const { data, error } = await db.from("tasks")
    .select("id, contact_id, title, due_at, created_at")
    .eq("account_id", accountId).is("completed_at", null)
    .order("created_at", { ascending: true }).limit(200);
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

/** `listAgencyWork`'s own row shape: every `WorkRow` field plus the three the
 *  agency-wide screen needs and a per-account row does not — `brandName`
 *  (never `accounts.name`, see below), `timezone`, so the zone a row's own
 *  bucket depends on travels WITH the row rather than requiring a second,
 *  separate account read to look it up (Work Queue Task 6), and
 *  `suppressed`, carried the same way, since 2026-09-15: a suppressed
 *  account's own customers still wait on a reply, and the previous behaviour
 *  — dropping the account from this read entirely — made a blank queue
 *  indistinguishable from a finished one on the exact account that most
 *  needed to be seen. Nothing about actual sending changes; this is a
 *  read-only screen that now shows the row and flags it, so the agency
 *  knows not to text. */
export type AgencyWorkRow = WorkRow & { brandName: string; timezone: string; suppressed: boolean };

/**
 * Runs `fn` over `items` with at most `AGENCY_READ_CONCURRENCY` in flight,
 * returning results in INPUT order (`Promise.all` resolves in input order,
 * not completion order, so chunked results can be concatenated as-is).
 *
 * `listAgencyWork` measured at ~95ms + ~135ms per account, SERIAL, on live
 * data — a third of a second at two accounts, several seconds at
 * twenty-five, paid on every uncached pageview. Bounded rather than
 * unbounded for the same reason `demo/seed.ts`'s own `inParallel` is: this
 * reads the ONE Supabase project production runs on, and an unbounded
 * fan-out over every account trades a linear-latency cost for a
 * connection-storm risk instead of removing it.
 */
export const AGENCY_READ_CONCURRENCY = 8;

export async function mapBounded<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += AGENCY_READ_CONCURRENCY) {
    const chunk = items.slice(i, i + AGENCY_READ_CONCURRENCY);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

export async function listAgencyWork(
  db: SupabaseClient,
): Promise<AgencyWorkRow[]> {
  // No `.eq("outbound_suppressed", false)` here any more (2026-09-15) — see
  // `AgencyWorkRow.suppressed`'s own comment above. `name` stays selected
  // and is now genuinely used, below, as this screen's OWN fallback for a
  // null/blank `brand_name` — the caption is the only thing on this screen
  // that says which company a row belongs to, and this screen is agency-only
  // by construction (requireAgency, page.tsx), so the internal label is
  // safe here in a way it is not on any customer-facing surface.
  const { data, error } = await db.from("accounts")
    .select("id, brand_name, name, timezone, outbound_suppressed");
  if (error) throw new Error(`listAgencyWork accounts read failed: ${error.message}`);

  const perAccount = await mapBounded(data ?? [], async (a) => {
    const brandName = a.brand_name?.trim() || a.name;
    const rows = await listAccountWork(db, a.id);
    return rows.map((r): AgencyWorkRow => ({
      ...r, brandName, timezone: a.timezone, suppressed: a.outbound_suppressed === true,
    }));
  });
  return perAccount.flat();
}
