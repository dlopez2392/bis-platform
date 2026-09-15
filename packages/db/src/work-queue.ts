import type { SupabaseClient } from "@supabase/supabase-js";
import { brandDisplayName } from "./branding";

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
  // other two (below) both order-then-limit(200). bucketWork re-sorts
  // everything it receives by its own due/occurred date regardless, so this
  // only decides WHICH 200 make the cut when an account somehow has more
  // open tasks than that — but which 200 still matters, because a dropped
  // row is gone from the screen, not just re-ordered on it.
  //
  // Ordered by due_at ascending, NULLS LAST, not by created_at: the screen
  // buckets by due date (Overdue/Today outrank Waiting), so a dated task
  // must survive the cut ahead of an undated one, however old the undated
  // one is. created_at-ascending, the previous order, could drop a task due
  // TODAY in favour of a years-old task with no due date at all, just
  // because the undated one happened to be created first — caught in review
  // 2026-09-15 against exactly that shape (200 undated tasks inserted
  // before one due-today task). created_at is kept as the tiebreak, so rows
  // sharing a due_at (including every undated one, tied on NULL) still order
  // deterministically rather than at the database's discretion.
  const { data, error } = await db.from("tasks")
    .select("id, contact_id, title, due_at, created_at")
    .eq("account_id", accountId).is("completed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(200);
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
 *  (resolved by `brandDisplayName`, which takes no fallback argument, so it
 *  is NEVER `accounts.name`; a blank name comes through here as `""`, and
 *  rendering a caption for it is `agency-work-list.tsx`'s job, not this
 *  layer's — see `listAgencyWork`'s own comment below), `timezone`, so the
 *  zone a row's own bucket depends on travels WITH the row rather than
 *  requiring a second, separate account read to look it up (Work Queue
 *  Task 6), and `suppressed`, carried the same way, since 2026-09-15: a
 *  suppressed account's own customers still wait on a reply, and the
 *  previous behaviour — dropping the account from this read entirely —
 *  made a blank queue indistinguishable from a finished one on the exact
 *  account that most needed to be seen. Nothing about actual sending
 *  changes; this is a read-only screen that now shows the row and flags
 *  it, so the agency knows not to text. */
export type AgencyWorkRow = WorkRow & { brandName: string; timezone: string; suppressed: boolean };

/**
 * Runs `fn` over `items` with at most `AGENCY_READ_CONCURRENCY` in flight,
 * returning results in INPUT order (`Promise.all` resolves in input order,
 * not completion order, so chunked results can be concatenated as-is).
 *
 * The serial baseline this replaced measured ~95ms + ~135ms per account —
 * a third of a second at two accounts, paid on every uncached pageview. That
 * cost model predicted roughly an 8x speedup from `AGENCY_READ_CONCURRENCY`
 * (eight accounts' worth of per-account latency overlapped). It does not
 * hold: re-measured against live data at five accounts, 2026-09-15, the
 * concurrent read is only about 1.5x faster than serial, not 5-8x — the
 * bottleneck moved from round-trip latency to server-side contention.
 * `listAccountWork` fans out to two or three queries per account
 * (`unansweredConversations` alone issues two), so a chunk of eight
 * concurrent accounts puts roughly twenty queries in flight against the
 * SAME Supabase project at once, and that is what the wall-clock time now
 * actually reflects. Bounded rather than unbounded for the same reason
 * `demo/seed.ts`'s own `inParallel` is: an unbounded fan-out over every
 * account would trade a linear-latency cost for a connection-storm risk
 * instead of removing it — this repo's cost model was wrong about the
 * SIZE of the win, not about the direction of the fix.
 *
 * Chunked, not a worker pool: `mapBounded` waits for an entire chunk of
 * `AGENCY_READ_CONCURRENCY` to finish before starting the next one, so one
 * slow account inside a chunk stalls every account queued after it, even an
 * idle slot beside it that finished early. A worker pool that refills a slot
 * the moment it frees would not have this property; this helper does not do
 * that, and a future caller with a wide latency spread across accounts
 * should not assume it does.
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
  // `AgencyWorkRow.suppressed`'s own comment above.
  //
  // `name` is NOT selected, and there is no fallback to it below. Reviewed
  // 2026-09-15: this screen is agency-only by construction (`requireAgency`,
  // `page.tsx`), but `brandDisplayName` (branding.ts) takes no second
  // argument to fall back to, deliberately — `accounts.name` is the agency's
  // internal label ("Rio Roofing — trial") and reached customers three times
  // while a resolver still accepted it as one; removing the parameter is
  // what makes that leak impossible rather than merely discouraged, and this
  // screen's field is named `brandName` the same as three others that
  // document it as customer-facing, so keeping a same-shaped fallback here
  // would have been a silent trap for whichever of those consumers this one
  // gets copied from next, guarded by nothing but this comment and the
  // route's own gate. A blank `brand_name` is unreachable through the
  // product today — migration 0028 backfilled every existing row, and
  // `createAccount`, the Branding save, and go-live all keep it populated
  // since — so this is closing a state that cannot occur on real data (a
  // live read across every account found zero blanks), not a live gap; the
  // db-level test reaches it only by nulling the column by hand. If it ever
  // IS blank, `brandName` here is `""`, and `agency-work-list.tsx` is where
  // that renders a neutral placeholder — never this layer.
  const { data, error } = await db.from("accounts")
    .select("id, brand_name, timezone, outbound_suppressed");
  if (error) throw new Error(`listAgencyWork accounts read failed: ${error.message}`);

  const perAccount = await mapBounded(data ?? [], async (a) => {
    const brandName = brandDisplayName({
      brandName: a.brand_name, brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null,
      brandMode: null, replyToEmail: null,
    });
    const rows = await listAccountWork(db, a.id);
    return rows.map((r): AgencyWorkRow => ({
      ...r, brandName, timezone: a.timezone, suppressed: a.outbound_suppressed === true,
    }));
  });
  return perAccount.flat();
}
