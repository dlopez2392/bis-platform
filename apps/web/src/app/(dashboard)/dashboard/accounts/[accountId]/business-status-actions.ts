"use server";

// S-47d (plan "The model" / "The guard", spec §5.2): set, and undo, the one switch. The picker and the
// To-do filer read through the SAME pure modules this calls (`status.ts`, `guard.ts`), so the server
// action and the card can never disagree about what today's status is or who may change it.
import {
  serviceDb, readAccountTimezone, readHoursChain, listClosedDaysFrom, getBusinessStatusRow,
  ensureBusinessStatusRow, updateBusinessStatus, listClosureAppointments, bumpHeldForAccount,
  deleteOpenClosureTask, emit, type BusinessStatusRow,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { fileClosureTodo } from "@/lib/business-status/closure-todo";
import { mayChangeStatus } from "@/lib/business-status/guard";
import {
  addDays, coversAppointment, closureListWindow, dayKey, effectiveStatus, hoursChain, isDateKey, rowInForce, toWire,
  untilFor, type ClosedDay, type LateMinutes, type StatusChange, type StatusInput,
  type StoredState, type WireStatus,
} from "@/lib/business-status/status";

export type UndoToken = {
  expectedSetAt: string;
  before: { state: StoredState; late_minutes: LateMinutes | null; until: string | null };
  todoId: string | null;
};
export type StatusActionResult =
  | { ok: true; effective: WireStatus; undo: UndoToken; todoCount: number }
  | { ok: false; error: string };

const STATES: readonly StoredState[] = ["open", "closed_today", "running_late", "storm"];
const LATE_MINUTES: readonly LateMinutes[] = [15, 30, 60, 120];

/** Step 1's shape check (spec §5.2): a known state, lateMinutes in {15,30,60,120}, backOn null or a real
 *  calendar date. Never trusts the compile-time `StatusChange` type alone — a server action is an
 *  endpoint like any other, and the wire can carry anything. */
function validateChange(change: StatusChange): StatusChange | null {
  if (change === null || typeof change !== "object") return null;
  const state = (change as { state?: unknown }).state;
  if (!STATES.includes(state as StoredState)) return null;
  if (state === "running_late") {
    const lateMinutes = (change as { lateMinutes?: unknown }).lateMinutes;
    return LATE_MINUTES.includes(lateMinutes as LateMinutes) ? { state: "running_late", lateMinutes: lateMinutes as LateMinutes } : null;
  }
  if (state === "storm") {
    const backOn = (change as { backOn?: unknown }).backOn;
    if (backOn === null) return { state: "storm", backOn: null };
    return typeof backOn === "string" && isDateKey(backOn) ? { state: "storm", backOn } : null;
  }
  if (state === "open") return { state: "open" };
  return { state: "closed_today" };
}

function refusalMessage(reason: "close_or_reopen" | "role", locale: "en" | "es"): string {
  return reason === "close_or_reopen" ? t(m, "business.refuse.closeOrReopen", locale) : t(m, "business.refuse.role", locale);
}

/** Step 2: the zone, the hours chain, the closed days from yesterday on, and the stored row — everything
 *  `effectiveStatus` needs, read once and reused for the guard, the update and the answer. */
async function readSnapshot(db: Awaited<ReturnType<typeof dbForRequest>>, accountId: string, now: Date) {
  const tz = (await readAccountTimezone(db, accountId)) ?? "UTC";
  const today = dayKey(now, tz);
  const [raw, closedDayRows, row] = await Promise.all([
    readHoursChain(db, accountId),
    listClosedDaysFrom(db, accountId, addDays(today, -1)),
    getBusinessStatusRow(db, accountId),
  ]);
  const hours = hoursChain(raw.businessHours, raw.calendarHours);
  const closedDays: readonly ClosedDay[] = closedDayRows;
  return { tz, today, hours, closedDays, row };
}

/** Step 10's "before, as a row": an expired stored closure or no row reads open; otherwise the stored
 *  row's own three columns, verbatim (D3: expiry on read). */
function beforeRow(row: BusinessStatusRow | null, now: Date): UndoToken["before"] {
  if (row && rowInForce(row, now)) return { state: row.state, late_minutes: row.late_minutes, until: row.until };
  return { state: "open", late_minutes: null, until: null };
}

/** Step 8: files the one closure To-do for today, only when at least one appointment in the closure's
 *  OWN window (S22/S7) is covered and not already kept. Returns the count and, when a NEW row was
 *  filed, its id (never an id that dedupe (`tasks_closure_once`) only re-read). */
async function fileIfAffected(
  db: Awaited<ReturnType<typeof dbForRequest>>, accountId: string, actorId: string, today: string,
  input: StatusInput,
): Promise<{ todoId: string | null; todoCount: number }> {
  const w = closureListWindow(input); // never null for closed_today/storm — the caller only reaches here then
  if (!w) return { todoId: null, todoCount: 0 };
  const appts = await listClosureAppointments(db, accountId, w.from.toISOString(), w.to.toISOString());
  const affected = appts.filter((a) => a.closure_kept_at === null && coversAppointment(input, new Date(a.starts_at)).covered);
  if (affected.length === 0) return { todoId: null, todoCount: 0 };
  try {
    const filed = await fileClosureTodo(serviceDb(), { accountId, kind: "status", on: today, createdBy: actorId });
    return { todoId: filed.created ? filed.id : null, todoCount: affected.length };
  } catch (e) {
    console.error(`setBusinessStatusAction: closure to-do failed for account ${accountId}: ${String(e)}`);
    return { todoId: null, todoCount: affected.length };
  }
}

export async function setBusinessStatusAction(
  accountId: string, change: StatusChange, locale: "en" | "es",
): Promise<StatusActionResult> {
  const access = await requireAccountAccess(accountId);
  const validated = validateChange(change);
  if (!validated) return { ok: false, error: t(m, "business.toast.failed", locale) };
  change = validated;

  const now = new Date();
  const db = await dbForRequest();
  const { tz, today, hours, closedDays, row } = await readSnapshot(db, accountId, now);
  const input: StatusInput = { row, closedDays, hours, timezone: tz, now };
  const effectiveBefore = effectiveStatus(input);

  const guard = mayChangeStatus({ isAgency: access.isAgency, role: access.role }, effectiveBefore, change);
  if (!guard.ok) return { ok: false, error: refusalMessage(guard.reason, locale) };

  if (change.state === "storm" && change.backOn !== null) {
    const lo = addDays(today, 1);
    const hi = addDays(today, 92);
    if (change.backOn < lo || change.backOn > hi) return { ok: false, error: t(m, "business.storm.dateError", locale) };
  }

  if (!row) {
    try {
      await ensureBusinessStatusRow(serviceDb(), accountId);
    } catch (e) {
      console.error(`setBusinessStatusAction: ensure row failed for account ${accountId}: ${String(e)}`);
      return { ok: false, error: t(m, "business.toast.failed", locale) };
    }
  }

  const lateMinutes = change.state === "running_late" ? change.lateMinutes : null;
  const until = untilFor(change, hours, tz, now);
  let updated: BusinessStatusRow | null;
  try {
    updated = await updateBusinessStatus(db, accountId, {
      state: change.state, late_minutes: lateMinutes, until: until ? until.toISOString() : null,
    });
  } catch (e) {
    console.error(`setBusinessStatusAction: update failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: t(m, "business.toast.failed", locale) };
  }
  if (updated === null) return { ok: false, error: t(m, "business.refuse.role", locale) };

  try {
    // The change log is the reminder hold's closure history (automations/closures.ts, S-47d D13b), so it is
    // written by the server as 'system': record_event (0053) lets any signed-in member append a 'user'
    // event for their own account, and the history reads only 'system' rows, which a client cannot forge.
    // The person is kept, in actor_id and in payload.by (Task 9 review I1).
    await emit(serviceDb(), accountId, "business_status.changed", access.userId, {
      from: effectiveBefore.state, to: change.state, late_minutes: lateMinutes,
      until: until ? until.toISOString() : null, by: access.userId,
    }, "system");
  } catch (e) {
    console.error(`setBusinessStatusAction: event emit failed for account ${accountId}: ${String(e)}`);
  }

  let todoId: string | null = null;
  let todoCount = 0;
  if (change.state === "closed_today" || change.state === "storm") {
    const afterInput: StatusInput = { row: updated, closedDays, hours, timezone: tz, now };
    ({ todoId, todoCount } = await fileIfAffected(db, accountId, access.userId, today, afterInput));
  }

  try {
    await bumpHeldForAccount(serviceDb(), accountId);
  } catch (e) {
    console.error(`setBusinessStatusAction: bump failed for account ${accountId}: ${String(e)}`);
  }

  const effective = effectiveStatus({ row: updated, closedDays, hours, timezone: tz, now });
  const undo: UndoToken = { expectedSetAt: updated.set_at, before: beforeRow(row, now), todoId };
  return { ok: true, effective: toWire(effective), undo, todoCount };
}

/** A `StatusChange` with only `.state` meaningful to the guard — `mayChangeStatus` never reads
 *  `lateMinutes`/`backOn`, only `.state`, so this exists purely to satisfy the type at the undo's
 *  guard call. */
function changeFor(before: UndoToken["before"]): StatusChange {
  if (before.state === "running_late") return { state: "running_late", lateMinutes: before.late_minutes ?? 15 };
  if (before.state === "storm") return { state: "storm", backOn: null };
  if (before.state === "closed_today") return { state: "closed_today" };
  return { state: "open" };
}

function isValidBefore(before: unknown): before is UndoToken["before"] {
  if (before === null || typeof before !== "object") return false;
  const b = before as { state?: unknown; late_minutes?: unknown; until?: unknown };
  if (!STATES.includes(b.state as StoredState)) return false;
  if (b.until !== null && (typeof b.until !== "string" || Number.isNaN(Date.parse(b.until)))) return false;
  if (b.state === "running_late") return LATE_MINUTES.includes(b.late_minutes as LateMinutes);
  return b.late_minutes === null;
}

function isValidToken(undo: UndoToken): boolean {
  if (undo === null || typeof undo !== "object") return false;
  if (typeof undo.expectedSetAt !== "string" || undo.expectedSetAt === "") return false;
  if (undo.todoId !== null && typeof undo.todoId !== "string") return false;
  return isValidBefore(undo.before);
}

export async function undoBusinessStatusAction(
  accountId: string, undo: UndoToken, locale: "en" | "es",
): Promise<{ ok: true; effective: WireStatus } | { ok: false; error: string }> {
  const access = await requireAccountAccess(accountId);
  if (!isValidToken(undo)) return { ok: false, error: t(m, "business.toast.failed", locale) };

  const now = new Date();
  const db = await dbForRequest();
  const { tz, hours, closedDays, row } = await readSnapshot(db, accountId, now);
  const effectiveNow = effectiveStatus({ row, closedDays, hours, timezone: tz, now });

  // Spec §5.2: an already-expired closure restores as open, never the expired state itself.
  const restoreTo = undo.before.until !== null && Date.parse(undo.before.until) <= now.getTime()
    ? { state: "open" as const, late_minutes: null, until: null }
    : undo.before;

  const guard = mayChangeStatus({ isAgency: access.isAgency, role: access.role }, effectiveNow, changeFor(restoreTo));
  if (!guard.ok) return { ok: false, error: refusalMessage(guard.reason, locale) };

  let updated: BusinessStatusRow | null;
  try {
    updated = await updateBusinessStatus(
      db, accountId, { state: restoreTo.state, late_minutes: restoreTo.late_minutes, until: restoreTo.until },
      { expectedSetAt: undo.expectedSetAt },
    );
  } catch (e) {
    console.error(`undoBusinessStatusAction: update failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: t(m, "business.toast.failed", locale) };
  }
  if (updated === null) return { ok: false, error: t(m, "business.toast.changedSince", locale) };

  if (undo.todoId) {
    try {
      await deleteOpenClosureTask(serviceDb(), accountId, undo.todoId);
    } catch (e) {
      console.error(`undoBusinessStatusAction: closure to-do delete failed for account ${accountId}: ${String(e)}`);
    }
  }

  try {
    // Server-written as 'system' with the person kept, exactly as the set above (Task 9 review I1).
    await emit(serviceDb(), accountId, "business_status.changed", access.userId, {
      from: effectiveNow.state, to: restoreTo.state, late_minutes: restoreTo.late_minutes, until: restoreTo.until,
      by: access.userId,
    }, "system");
  } catch (e) {
    console.error(`undoBusinessStatusAction: event emit failed for account ${accountId}: ${String(e)}`);
  }

  try {
    await bumpHeldForAccount(serviceDb(), accountId);
  } catch (e) {
    console.error(`undoBusinessStatusAction: bump failed for account ${accountId}: ${String(e)}`);
  }

  const effective = effectiveStatus({ row: updated, closedDays, hours, timezone: tz, now });
  return { ok: true, effective: toWire(effective) };
}
