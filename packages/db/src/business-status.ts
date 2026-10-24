import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { readAccountTimezone } from "./automation-settings";

/**
 * S-47d (0097): the one switch per account (`business_status`), the planned closed days (`closed_days`), the
 * appointments a closure covers and the Keep on each (`bookings.closure_kept_at`), and the one closure To-do per
 * account, kind and date (`tasks.closure_kind` / `tasks.closure_on`).
 *
 * Who may call what is the grants' and the policies' business, not this module's: `business_status` is UPDATEd
 * only by a signed-in client (0097 grants service_role no UPDATE), and INSERTed only by service_role. Every read
 * and write is scoped to the `accountId` it is given; RLS is the backstop, never the scope.
 */

export type BusinessState = "open" | "closed_today" | "running_late" | "storm";
export type LateMinutes = 15 | 30 | 60 | 120;
export type BusinessStatusRow = {
  account_id: string; state: BusinessState; late_minutes: LateMinutes | null;
  until: string | null; set_by: string; set_at: string;      // set_at VERBATIM from PostgREST (SD14)
};
export type ClosedDayReason = "holiday" | "vacation" | "other";
export type ClosedDayRow = {
  id: string; account_id: string; starts_on: string; ends_on: string;
  reason: ClosedDayReason | null; created_by: string; created_at: string;
};
export type BusinessStatusCode = "open" | "closed_today" | "running_late_15" | "running_late_30"
  | "running_late_60" | "running_late_120" | "storm" | "closed_day";
export type ClosureKind = "status" | "closed_day";
export type StatusPatch = { state: BusinessState; late_minutes: LateMinutes | null; until: string | null };
export type ClosureAppointment = {
  id: string; contact_id: string; starts_at: string; ends_at: string; closure_kept_at: string | null;
  first_name: string | null; last_name: string | null;
};
export type HoursChainRaw = { businessHours: unknown; calendarHours: unknown };
export type ClosureSnapshot = {
  timezone: string | null; row: BusinessStatusRow | null; closedDays: ClosedDayRow[];
  hours: HoursChainRaw;                 // no kept ids: Keep is read from each due row (SD20)
};

export const BUSINESS_STATUS_COLS = "account_id, state, late_minutes, until, set_by, set_at";
export const CLOSED_DAY_COLS = "id, account_id, starts_on, ends_on, reason, created_by, created_at";

/** null = no row (reads as open). Throws on a read error. */
export async function getBusinessStatusRow(db: SupabaseClient, accountId: string): Promise<BusinessStatusRow | null> {
  const { data, error } = await db.from("business_status").select(BUSINESS_STATUS_COLS)
    .eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getBusinessStatusRow failed: ${error.message}`);
  return (data as BusinessStatusRow | null) ?? null;
}

/** service_role only: insert … on conflict (account_id) do nothing (upsert, ignoreDuplicates). Throws on error. */
export async function ensureBusinessStatusRow(db: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await db.from("business_status")
    .upsert({ account_id: accountId }, { onConflict: "account_id", ignoreDuplicates: true });
  if (error) throw new Error(`ensureBusinessStatusRow failed: ${error.message}`);
}

/** The signed-in client. Updates the three columns where account_id matches (and set_at = expectedSetAt
 *  when given); returns the row read back, or null when no row matched (RLS USING, or a lost
 *  compare-and-set). A 42501 (RLS WITH CHECK, SD1) also returns null. Any other error throws.
 *
 *  `expectedSetAt` is compared as the STRING PostgREST returned (microseconds). Never round it through a
 *  `Date`: that keeps milliseconds, names an instant that was never stored, and so never matches (SD14). */
export async function updateBusinessStatus(db: SupabaseClient, accountId: string, patch: StatusPatch,
  opts: { expectedSetAt?: string } = {}): Promise<BusinessStatusRow | null> {
  let q = db.from("business_status")
    .update({ state: patch.state, late_minutes: patch.late_minutes, until: patch.until })
    .eq("account_id", accountId);
  if (opts.expectedSetAt !== undefined) q = q.eq("set_at", opts.expectedSetAt);
  const { data, error } = await q.select(BUSINESS_STATUS_COLS);
  if (error) {
    if (error.code === "42501") return null;
    throw new Error(`updateBusinessStatus failed: ${error.message}`);
  }
  const rows = (data ?? []) as BusinessStatusRow[];
  return rows[0] ?? null;
}

/** ends_on >= fromDate, order starts_on asc then id asc, at most `limit` (default 100). Throws on error. */
export async function listClosedDaysFrom(
  db: SupabaseClient, accountId: string, fromDate: string, limit = 100,
): Promise<ClosedDayRow[]> {
  const { data, error } = await db.from("closed_days").select(CLOSED_DAY_COLS)
    .eq("account_id", accountId).gte("ends_on", fromDate)
    .order("starts_on", { ascending: true }).order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listClosedDaysFrom failed: ${error.message}`);
  return (data ?? []) as ClosedDayRow[];
}

/** Signed-in insert of the four columns; returns the stored row (created_by stamped). Throws on error (the
 *  error keeps its PostgREST `code`). */
export async function insertClosedDay(db: SupabaseClient, accountId: string,
  input: { starts_on: string; ends_on: string; reason: ClosedDayReason | null }): Promise<ClosedDayRow> {
  const { data, error } = await db.from("closed_days")
    .insert({ account_id: accountId, starts_on: input.starts_on, ends_on: input.ends_on, reason: input.reason })
    .select(CLOSED_DAY_COLS).single();
  if (error || !data) {
    throw Object.assign(new Error(`insertClosedDay failed: ${error?.message ?? "no row"}`), { code: error?.code });
  }
  return data as ClosedDayRow;
}

/** Deletes one range of this account; returns it, or null when nothing matched. */
export async function deleteClosedDay(db: SupabaseClient, accountId: string, id: string): Promise<ClosedDayRow | null> {
  const { data, error } = await db.from("closed_days").delete()
    .eq("account_id", accountId).eq("id", id).select(CLOSED_DAY_COLS);
  if (error) throw new Error(`deleteClosedDay failed: ${error.message}`);
  return ((data ?? []) as ClosedDayRow[])[0] ?? null;
}

/** voice_profiles.business_hours and calendars.open_hours, read in parallel. Each failing read logs one
 *  line (ids only) and yields null; never throws. */
export async function readHoursChain(db: SupabaseClient, accountId: string): Promise<HoursChainRaw> {
  const read = async (table: "voice_profiles" | "calendars", col: "business_hours" | "open_hours"): Promise<unknown> => {
    try {
      const { data, error } = await db.from(table).select(col).eq("account_id", accountId).maybeSingle();
      if (error) {
        console.error(`readHoursChain: ${table} read failed for account ${accountId} (${error.code ?? "no code"})`);
        return null;
      }
      return (data as Record<string, unknown> | null)?.[col] ?? null;
    } catch {
      console.error(`readHoursChain: ${table} read threw for account ${accountId}`);
      return null;
    }
  };
  const [businessHours, calendarHours] = await Promise.all([
    read("voice_profiles", "business_hours"), read("calendars", "open_hours"),
  ]);
  return { businessHours, calendarHours };
}

/** minors-1b item 5: the cap `listClosureAppointments` had none of. 200 is well past what any one
 *  account's closure window (at most 14 days ahead, S7/S22, or one closed-day range at a time) should
 *  ever book — a caller at the cap should treat its count as "at least this many", never as exact. */
export const CLOSURE_APPOINTMENTS_LIMIT = 200;

/** status = 'booked', starts_at in [fromIso, toIso), order starts_at, with the contact's first/last name
 *  (embed `contacts(first_name, last_name)`), capped at `CLOSURE_APPOINTMENTS_LIMIT`. Throws on error. */
export async function listClosureAppointments(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<ClosureAppointment[]> {
  const { data, error } = await db.from("bookings")
    .select("id, contact_id, starts_at, ends_at, closure_kept_at, contacts(first_name, last_name)")
    .eq("account_id", accountId).eq("status", "booked")
    .gte("starts_at", fromIso).lt("starts_at", toIso)
    .order("starts_at", { ascending: true })
    .limit(CLOSURE_APPOINTMENTS_LIMIT);
  if (error) throw new Error(`listClosureAppointments failed: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    id: string; contact_id: string; starts_at: string; ends_at: string; closure_kept_at: string | null;
    contacts: { first_name: string | null; last_name: string | null } | null;
  }[];
  return rows.map((r) => ({
    id: r.id, contact_id: r.contact_id, starts_at: r.starts_at, ends_at: r.ends_at,
    closure_kept_at: r.closure_kept_at ?? null,
    first_name: r.contacts?.first_name ?? null, last_name: r.contacts?.last_name ?? null,
  }));
}

/** Held automation_log rows per booking: Map<bookingId, count> from subject_key 'booking:<id>'. */
export async function countHeldByBooking(
  db: SupabaseClient, accountId: string, bookingIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (bookingIds.length === 0) return counts;
  const { data, error } = await db.from("automation_log").select("subject_key")
    .eq("account_id", accountId).eq("status", "held")
    .in("subject_key", bookingIds.map((i) => `booking:${i}`));
  if (error) throw new Error(`countHeldByBooking failed: ${error.message}`);
  for (const r of (data ?? []) as { subject_key: string }[]) {
    const id = r.subject_key.slice("booking:".length);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** service_role. Sets (kept) or clears closure_kept_at on a 'booked' booking of this account; true when a row changed. */
export async function setBookingClosureKept(
  db: SupabaseClient, accountId: string, bookingId: string, kept: boolean,
): Promise<boolean> {
  const { data, error } = await db.from("bookings")
    .update({ closure_kept_at: kept ? new Date().toISOString() : null })
    .eq("account_id", accountId).eq("id", bookingId).eq("status", "booked")
    .select("id");
  if (error) throw new Error(`setBookingClosureKept failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** service_role. One To-do per account, kind and date: insert, and on 23505 re-read the existing id. Emits
 *  task.created on a real insert (ensureDocumentExpiryTask's shape, packages/db/src/document-expiry.ts:62-81).
 *
 *  `created_by` is sent as the plan names it, but 0073's tasks_stamp_created_by stores NULL for a service_role
 *  insert whatever is sent; who filed it is the task.created event's actor. */
export async function ensureClosureTask(db: SupabaseClient, accountId: string,
  input: { kind: ClosureKind; on: string; title: string; createdBy: string }): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks").insert({
    account_id: accountId, title: input.title, due_at: new Date().toISOString(), contact_id: null,
    assigned_to: null, created_by: input.createdBy, closure_kind: input.kind, closure_on: input.on,
  }).select("id").single();
  if (!error && data) {
    const id = (data as { id: string }).id;
    await emit(db, accountId, "task.created", input.createdBy, { taskId: id, contactId: null }, "user");
    return { id, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureClosureTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks").select("id")
    .eq("account_id", accountId).eq("closure_kind", input.kind).eq("closure_on", input.on).maybeSingle();
  if (readErr || !found) throw new Error(`ensureClosureTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}

/** service_role. Deletes the task only while it is open (completed_at null) and still a closure To-do. */
export async function deleteOpenClosureTask(db: SupabaseClient, accountId: string, taskId: string): Promise<boolean> {
  const { data, error } = await db.from("tasks").delete()
    .eq("account_id", accountId).eq("id", taskId).is("completed_at", null).not("closure_kind", "is", null)
    .select("id");
  if (error) throw new Error(`deleteOpenClosureTask failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The cron loader's one read per account per tick (Task 9): accounts.timezone, the row, the closed days
 *  ending on or after `sinceDate`, and the hours chain, all for THIS accountId. Throws when any of the
 *  first three fails (the hours chain never throws). */
export async function loadClosureSnapshot(db: SupabaseClient, accountId: string,
  since: { date: string }): Promise<ClosureSnapshot> {
  const [timezone, row, closedDays, hours] = await Promise.all([
    readAccountTimezone(db, accountId),
    getBusinessStatusRow(db, accountId),
    listClosedDaysFrom(db, accountId, since.date),
    readHoursChain(db, accountId),
  ]);
  return { timezone, row, closedDays, hours };
}

/** One `business_status.changed` event as the switch's set and undo actions write it
 *  (apps/web business-status-actions.ts, through `emit`): `to` is the state set (null when the payload names
 *  none we know), `until` the stored until, `from` the EFFECTIVE state it replaced, `at` the event's own time. */
export type BusinessStatusChange = { at: string; from: string | null; to: BusinessState | null; until: string | null };

const STATES: readonly string[] = ["open", "closed_today", "running_late", "storm"];
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** S-47d D13b: the switch's own change log for THIS account, the closure history the reminder hold reads:
 *  `business_status.changed` events WRITTEN BY THE SERVER (actor_type 'system'), created at or after
 *  `sinceIso`, oldest first. 'system' is the whole guard: record_event (0053) lets any signed-in member of
 *  the account append any event, but always as 'user', so a client cannot forge a closure into the
 *  history or cut a real one short (Task 9 review I1). The switch's actions emit through the service
 *  client as 'system' and keep the person in actor_id and payload.by. When there are more than
 *  `limit`, the newest `limit`. One range read on `events_account_created (account_id, created_at desc)` with
 *  the type as a filter. A payload it cannot read maps to nulls, never a throw. Throws on a read error. */
export async function listBusinessStatusChanges(db: SupabaseClient, accountId: string, sinceIso: string,
  limit = 500): Promise<BusinessStatusChange[]> {
  const { data, error } = await db.from("events").select("payload, created_at")
    .eq("account_id", accountId).eq("type", "business_status.changed").eq("actor_type", "system")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`listBusinessStatusChanges failed: ${error.message}`);
  return ((data ?? []) as { payload: unknown; created_at: string }[]).reverse().map((r) => {
    const p = (r.payload !== null && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
    const to = str(p.to);
    return { at: r.created_at, from: str(p.from), to: to !== null && STATES.includes(to) ? (to as BusinessState) : null, until: str(p.until) };
  });
}
