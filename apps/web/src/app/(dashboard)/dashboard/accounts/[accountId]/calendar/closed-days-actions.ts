"use server";

// S-47d (plan "The model" / spec §5, §6): planned closed days — Owners and the agency only (`canManage`,
// D1, unchanged by D8). Dates are calendar keys ("YYYY-MM-DD") in the account's own zone throughout; the
// range's instants (for the appointments it affects) are computed in that same zone with the pure reader's
// `startOfDay`/`addDays`, never a naive UTC date.
import {
  serviceDb, readAccountTimezone, listClosedDaysFrom, insertClosedDay, deleteClosedDay,
  listClosureAppointments, bumpHeldForAccount, emit, type ClosedDayReason,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { fileClosureTodo, closureTodoDates } from "@/lib/business-status/closure-todo";
import { addDays, dayKey, startOfDay } from "@/lib/business-status/status";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(s: string): boolean {
  return DATE_RE.test(s) && addDays(s, 0) === s;
}

/** Inclusive calendar-day span between two date keys (`b` minus `a`, in whole days) — the shape 0097's
 *  own `closed_days_range_check` uses (`ends_on - starts_on <= 91`). */
function daysBetween(a: string, b: string): number {
  const p = (k: string) => k.split("-").map(Number) as [number, number, number];
  const [ay, am, ad] = p(a);
  const [by, bm, bd] = p(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type AddClosedDayInput = { from: string; to: string | null; reason: ClosedDayReason | null; restore?: boolean };
export type AddClosedDayResult =
  | { ok: true; id: string; appointments: number; todoFiled: boolean }
  | { ok: false; error: string };
export type RemoveClosedDayResult =
  | { ok: true; removed: { from: string; to: string; reason: ClosedDayReason | null } }
  | { ok: false; error: string };

export async function addClosedDayAction(
  accountId: string, input: AddClosedDayInput, locale: "en" | "es",
): Promise<AddClosedDayResult> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return { ok: false, error: t(m, "closedDays.role", locale) };

  const from = input.from;
  const to = input.to ?? input.from;
  if (typeof from !== "string" || !isDateKey(from) || typeof to !== "string" || !isDateKey(to)) {
    return { ok: false, error: t(m, "closedDays.saveFailed", locale) };
  }

  const db = await dbForRequest();
  const now = new Date();
  const tz = (await readAccountTimezone(db, accountId)) ?? "UTC";
  const today = dayKey(now, tz);
  const earliestFrom = input.restore === true ? addDays(today, -1) : today;

  if (from < earliestFrom) return { ok: false, error: t(m, "closedDays.error.past", locale) };
  if (to < from) return { ok: false, error: t(m, "closedDays.error.endBeforeStart", locale) };
  if (daysBetween(from, to) > 91) return { ok: false, error: t(m, "closedDays.error.tooLong", locale) };
  if (to > addDays(today, 365)) return { ok: false, error: t(m, "closedDays.error.tooFar", locale) };

  const existing = await listClosedDaysFrom(db, accountId, today);
  const overlap = existing.find((r) => r.starts_on <= to && r.ends_on >= from);
  if (overlap) {
    const range = closureTodoDates(overlap.starts_on, overlap.ends_on, locale);
    return { ok: false, error: t(m, "closedDays.error.overlap", locale, { range }) };
  }

  let inserted;
  try {
    inserted = await insertClosedDay(db, accountId, { starts_on: from, ends_on: to, reason: input.reason });
  } catch (e) {
    console.error(`addClosedDayAction: insert failed for account ${accountId}: ${String(e)}`);
    const code = (e as { code?: string }).code;
    if (code === "42501") return { ok: false, error: t(m, "closedDays.role", locale) };
    return { ok: false, error: t(m, "closedDays.saveFailed", locale) };
  }

  try {
    await emit(db, accountId, "closed_day.added", access.userId, {
      id: inserted.id, starts_on: inserted.starts_on, ends_on: inserted.ends_on, reason: inserted.reason,
    }, "user");
  } catch (e) {
    console.error(`addClosedDayAction: event emit failed for account ${accountId}: ${String(e)}`);
  }

  const windowFrom = startOfDay(inserted.starts_on, tz);
  const windowTo = startOfDay(addDays(inserted.ends_on, 1), tz);
  const appts = (await listClosureAppointments(db, accountId, windowFrom.toISOString(), windowTo.toISOString()))
    .filter((a) => a.closure_kept_at === null);

  let todoFiled = false;
  if (appts.length > 0) {
    try {
      await fileClosureTodo(serviceDb(), {
        accountId, kind: "closed_day", on: inserted.starts_on, to: inserted.ends_on, createdBy: access.userId,
      });
      todoFiled = true;
    } catch (e) {
      console.error(`addClosedDayAction: closure to-do failed for account ${accountId}: ${String(e)}`);
    }
  }

  try {
    await bumpHeldForAccount(serviceDb(), accountId);
  } catch (e) {
    console.error(`addClosedDayAction: bump failed for account ${accountId}: ${String(e)}`);
  }

  return { ok: true, id: inserted.id, appointments: appts.length, todoFiled };
}

export async function removeClosedDayAction(
  accountId: string, id: string, locale: "en" | "es",
): Promise<RemoveClosedDayResult> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return { ok: false, error: t(m, "closedDays.role", locale) };

  const db = await dbForRequest();
  let deleted;
  try {
    deleted = await deleteClosedDay(db, accountId, id);
  } catch (e) {
    console.error(`removeClosedDayAction: delete failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: t(m, "closedDays.saveFailed", locale) };
  }
  if (deleted === null) return { ok: false, error: t(m, "closedDays.saveFailed", locale) };

  try {
    await emit(db, accountId, "closed_day.removed", access.userId, {
      id: deleted.id, starts_on: deleted.starts_on, ends_on: deleted.ends_on, reason: deleted.reason,
    }, "user");
  } catch (e) {
    console.error(`removeClosedDayAction: event emit failed for account ${accountId}: ${String(e)}`);
  }

  try {
    await bumpHeldForAccount(serviceDb(), accountId);
  } catch (e) {
    console.error(`removeClosedDayAction: bump failed for account ${accountId}: ${String(e)}`);
  }

  return { ok: true, removed: { from: deleted.starts_on, to: deleted.ends_on, reason: deleted.reason } };
}
