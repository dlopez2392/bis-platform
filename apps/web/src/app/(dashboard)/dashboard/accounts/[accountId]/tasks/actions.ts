"use server";
//
// The To do screen's four actions (Work Queue Task 4). Every one starts with
// `requireAccountAccess`, then `revalidatePath` this route on success — but
// they do NOT all write through the same client. `completeWorkTask`,
// `reopenWorkTask` and `dismissToTask` write through `dbForRequest()`, the
// request-scoped client. `closeOutBooking` does not: it delegates the guard
// AND the write to `setBookingStatusAction` (calendar/actions.ts), which
// writes through `serviceDb()` for a reason recorded on that action's own
// doc comment — reused here rather than re-derived. `tomorrowAt9` lives in
// `@/lib/work/dismiss-date`, not here — this file carries `"use server"`,
// where every VALUE export must be an async function, and that helper is
// synchronous.
//
// Return shape is `ActionResult`, not `void`: every existing dashboard
// action (`calendar/actions.ts`, `contacts/actions.ts`, …) returns a
// success/error union so the client can toast a real failure instead of
// silence. `void` cannot surface an error at all.

import { revalidatePath } from "next/cache";
import { addTask, completeTask, reopenTask, type WorkSource } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { tomorrowAt9 } from "@/lib/work/dismiss-date";
import { setBookingStatusAction } from "../calendar/actions";

export type ActionResult = { ok: true } | { ok: false; error: string };
/** `dueAt` is the ISO instant actually written (or `null` on the zone-degrade
 *  path) — carried on the result, not just the write, so the CLIENT can tell
 *  the two cases apart. "Moved to tomorrow." is a lie on the degrade path,
 *  where no due date was set and nothing moved; the caller decides which
 *  toast to show from this field rather than always assuming the dated
 *  case. */
export type DismissResult =
  | { ok: true; taskId: string; dueAt: string | null }
  | { ok: false; error: string };

function tasksPath(accountId: string): string {
  return `/dashboard/accounts/${accountId}/tasks`;
}

/** "Done" — the task row's own button. */
export async function completeWorkTask(accountId: string, taskId: string): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    await completeTask(await dbForRequest(), accountId, taskId, userId);
  } catch (e) {
    console.error(`completeWorkTask: failed for task ${taskId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["work.actionFailed"] };
  }
  revalidatePath(tasksPath(accountId));
  return { ok: true };
}

/**
 * Undoes "Done" (DESIGN.md rule 6: reversible actions get a real undo, and
 * an undo needs the reverse operation to exist — `reopenTask` is that
 * reverse, added to `activities.ts` for exactly this).
 */
export async function reopenWorkTask(accountId: string, taskId: string): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    await reopenTask(await dbForRequest(), accountId, taskId, userId);
  } catch (e) {
    console.error(`reopenWorkTask: failed for task ${taskId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["work.actionFailed"] };
  }
  revalidatePath(tasksPath(accountId));
  return { ok: true };
}

/**
 * "Not now" — pushes a derived (conversation) row to tomorrow by writing a
 * REAL task against the same contact (spec §3: no dismissals table exists;
 * the derived row stops matching once the task is open — suppression is
 * `listAccountWork`'s job, already built, untouched here). `row.title` is
 * the row's own already-rendered label, passed through verbatim — never
 * re-templated here, so the task the operator finds later reads exactly
 * like the row they dismissed.
 *
 * Reads the account's OWN timezone itself rather than trusting one from the
 * caller: `due_at` is a value this write actually stores, and the zone that
 * turns "tomorrow" into a real instant is precisely the thing that must
 * never come from the browser. An unresolvable zone (the timezone column is
 * free text with no validation upstream) degrades to no due date — the task
 * still gets created and still does its suppression job, honest rather than
 * a guessed moment (`tomorrowAt9`'s own contract: never a UTC fallback).
 * This does NOT mean it "lands in Waiting instead of Today": `bucketWork`
 * puts a task due tomorrow in Waiting today regardless (only a task due
 * TODAY buckets to Today), so a dated and an undated dismissal look
 * identical the moment they're created. The real difference shows up
 * tomorrow morning — the dated task's due day rolls onto `todayKey` and it
 * surfaces under Today, while the undated one has no `due_at` at all and
 * sits in Waiting permanently, the same as any other undated task.
 */
export async function dismissToTask(
  accountId: string,
  row: { source: WorkSource; contactId: string | null; title: string },
): Promise<DismissResult> {
  const { userId } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const { data, error } = await db
    .from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error || !data) {
    console.error(`dismissToTask: account lookup failed for ${accountId}: ${error?.message ?? "not found"}`);
    return { ok: false, error: m["work.actionFailed"] };
  }
  const account = data as { timezone: string };
  const resolvedDueAt = tomorrowAt9(new Date(), account.timezone);

  try {
    const { id } = await addTask(
      db, accountId,
      { contactId: row.contactId ?? undefined, title: row.title, dueAt: resolvedDueAt ?? undefined },
      userId,
    );
    revalidatePath(tasksPath(accountId));
    return { ok: true, taskId: id, dueAt: resolvedDueAt };
  } catch (e) {
    console.error(`dismissToTask: create failed for a "${row.source}" row (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["work.actionFailed"] };
  }
}

/**
 * Closing out a stale booking. Deliberately NOT a hand-written second
 * version of this write: `setBookingStatusAction` (calendar/actions.ts)
 * already exists and its own doc comment records why it must use the
 * service client rather than the request-scoped one (the column grant that
 * would make `dbForRequest()` safe for this write does not exist, on
 * purpose). Reusing it means inheriting that reasoning instead of
 * re-deriving — and likely getting — it wrong. Its one gap is that it only
 * revalidates the calendar path, so this thin wrapper adds the To do
 * route's own revalidation on success; on failure it forwards the result
 * (and the calendar screen's own, already-honest error copy) verbatim.
 */
export async function closeOutBooking(
  accountId: string, bookingId: string, status: "completed" | "no_show",
): Promise<ActionResult> {
  const result = await setBookingStatusAction(accountId, bookingId, status);
  if (result.ok) revalidatePath(tasksPath(accountId));
  return result;
}
