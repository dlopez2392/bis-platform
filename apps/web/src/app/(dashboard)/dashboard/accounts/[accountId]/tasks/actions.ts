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
import {
  addTask, completeTask, reopenTask, readTaskContact, readConsentHistory, newestDecidingRow,
  completeTasksForConsentEvents, HoldUndecidedError, setTaskAssignee, listAccountTeam,
  readPersonId, taskAssigneeFor,
  type WorkSource, type SupabaseClient,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid, isUuidOrNull, isRefusal } from "@/lib/assign/action-guards";
import type { AssignError } from "../contacts/actions";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { tomorrowAt9 } from "@/lib/work/dismiss-date";
import { loggableError } from "@/lib/loggable-error";
import { textsContextFor } from "@/lib/consent/texts-context";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { confirmStop, notAStop, undoHoldDecision, type TextsActionResult } from "@/lib/consent/staff-actions";
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
    // The task write stays on the request client (RLS decides which tasks the
    // caller may close); only the hold check's ledger read takes the ledger
    // client (F-085, spec §7.3) — a held number can be tied to no contact, so
    // a Technician's own client would not see the row the task links.
    await completeTask(await dbForRequest(), accountId, taskId, userId, "user", ledgerDb());
  } catch (e) {
    // Review R3-I1: a hold's To-do closes by deciding the hold (a stale tab
    // can still show its old Done).
    if (e instanceof HoldUndecidedError) return { ok: false, error: m["todo.consent.decideFirst"] };
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
    // F-085 fix round 1 (I1): a real task, so assigned like any other: the
    // customer's holder, else the person who pressed Not now. Without it a
    // Technician's insert is refused (0068's tasks_technician_insert) and
    // Owner/Staff's lands Unassigned.
    const assignedTo = await taskAssigneeFor(db, accountId, row.contactId, await readPersonId(db, accountId, userId));
    const { id } = await addTask(
      db, accountId,
      { contactId: row.contactId ?? undefined, title: row.title, dueAt: resolvedDueAt ?? undefined, assignedTo },
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

/**
 * The stale-hold path (review R3-I1, and fix round 1 item 1): a hold's To-do
 * has nothing left to ask — either the number's newest deciding row moved
 * on, or the contact has no textable number at all anymore (its phone was
 * cleared) — so it closes through its own ledger link rather than sitting
 * open behind two dead buttons. `consentEventId` absent is a plain task,
 * never reached by a hold's To-do; still a no-op guard, not an assumption.
 */
async function closeStaleHoldTodo(
  db: SupabaseClient, accountId: string, taskId: string, consentEventId: string | null, userId: string,
): Promise<void> {
  if (!consentEventId) return;
  try {
    await completeTasksForConsentEvents(db, accountId, [consentEventId], userId);
    revalidatePath(tasksPath(accountId));
  } catch (e) {
    console.error(`decideFromTask: stale hold To-do ${taskId} (account ${accountId}) not closed: ${loggableError(e)}`);
  }
}

/**
 * The consent To-do's two buttons (spec §6): decide the contact's CURRENT
 * hold, whatever hold the To-do was made for, through the same guarded write
 * as the drawer (lib/consent/staff-actions.ts), which also completes the
 * hold's To-dos. A number no longer on hold, OR a contact with no textable
 * number anymore (review fix round 1, item 1: `textsContextFor`'s `reason`
 * discriminant, never a copy-string comparison), says so, decides nothing,
 * and closes the To-do through its own ledger link (review R3-I1): it has
 * nothing left to ask. Any OTHER `textsContextFor` failure (a genuine read
 * error) is reported as-is and closes nothing — the hold may still be real.
 */
async function decideFromTask(
  accountId: string, taskId: string, decide: typeof confirmStop,
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    const db = await dbForRequest();
    const task = await readTaskContact(db, accountId, taskId);
    if (!task?.contactId) return { ok: false, error: m["todo.consent.decided"] };
    const ctx = await textsContextFor(accountId, task.contactId, userId);
    if ("ok" in ctx) {
      if (ctx.reason === "no_number") {
        await closeStaleHoldTodo(db, accountId, taskId, task.consentEventId, userId);
        return { ok: false, error: m["todo.consent.decided"] };
      }
      return ctx;
    }
    // By address, on the service client (F-085, spec §7.3): textsContextFor
    // proved the contact on the request client first.
    const newest = newestDecidingRow(await readConsentHistory(ctx.writer, accountId, "sms", ctx.address));
    if (!newest || newest.action !== "held") {
      await closeStaleHoldTodo(ctx.db, accountId, taskId, task.consentEventId, userId);
      return { ok: false, error: m["todo.consent.decided"] };
    }
    const result = await decide(ctx, newest.id);
    if (result.ok) revalidatePath(tasksPath(accountId));
    return result;
  } catch (e) {
    console.error(`decideFromTask: task ${taskId} (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, error: m["todo.consent.failed"] };
  }
}

export async function confirmStopFromTask(accountId: string, taskId: string): Promise<TextsActionResult> {
  return decideFromTask(accountId, taskId, confirmStop);
}

export async function notAStopFromTask(accountId: string, taskId: string): Promise<TextsActionResult> {
  return decideFromTask(accountId, taskId, notAStop);
}

export async function undoHoldDecisionFromTask(
  accountId: string, contactId: string, eventId: string, reopenTaskIds: string[],
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await textsContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return ctx;
  const result = await undoHoldDecision(ctx, eventId, reopenTaskIds);
  if (result.ok) revalidatePath(tasksPath(accountId));
  return result;
}

/**
 * Hands one task to someone, or to nobody (F-085 part 1, spec §8). Owner,
 * Staff and the agency only: a Technician never reassigns (M4), nor does a
 * client whose role could not be settled, and 0068's trigger refuses them
 * too. A Technician can only be handed a task about a customer they already
 * hold (A4: the customer first), because RLS would hide anything else from
 * them; a task with no customer is theirs to take. Everything is read on the
 * request client. Hands back who had it, which is what the Undo restores.
 *
 * `expected` is the Undo's (final review M7): the holder the save being
 * undone set. Given, the task moves only while that person (null:
 * Unassigned) still holds it, checked at the write (setTaskAssignee); a task
 * someone picked since answers "assign.changed" and stays with them.
 */
export async function setTaskAssigneeAction(
  accountId: string, taskId: string, assignee: string | null, expected?: string | null,
): Promise<{ ok: true; previous: string | null } | { ok: false; error: AssignError }> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return { ok: false, error: "assign.refused" };
  if (!isUuid(taskId) || !isUuidOrNull(assignee) || !(expected === undefined || isUuidOrNull(expected))) {
    return { ok: false, error: "assign.failed" };
  }
  try {
    const db = await dbForRequest();
    if (assignee !== null && await customerFirst(db, accountId, taskId, assignee)) {
      return { ok: false, error: "assign.customerFirst" };
    }
    const r = expected === undefined
      ? await setTaskAssignee(db, accountId, taskId, assignee, access.userId)
      : await setTaskAssignee(db, accountId, taskId, assignee, access.userId, { expected });
    if (r === "not_found") return { ok: false, error: "assign.failed" };
    if (r === "changed") return { ok: false, error: "assign.changed" };
    revalidatePath(tasksPath(accountId));
    return { ok: true, previous: r.previous };
  } catch (e) {
    console.error(`setTaskAssigneeAction: account ${accountId}: ${loggableError(e)}`);
    return { ok: false, error: isRefusal(e) ? "assign.refused" : "assign.failed" };
  }
}

/**
 * True when the target may be a Technician and the task's customer is not
 * theirs (A4). Fails closed (fix round 1, m3): only a target the team read
 * shows as Owner or Staff skips the check; one it does not show at all (just
 * removed, or a race) is checked like a Technician.
 */
async function customerFirst(db: SupabaseClient, accountId: string, taskId: string, assignee: string): Promise<boolean> {
  const team = await listAccountTeam(db, accountId);
  const role = team.find((t) => t.userId === assignee)?.role;
  if (role === "owner" || role === "staff") return false;
  const task = await readTaskContact(db, accountId, taskId);
  if (!task?.contactId) return false;
  const { data, error } = await db.from("contacts").select("assigned_to")
    .eq("account_id", accountId).eq("id", task.contactId).maybeSingle();
  if (error) throw new Error(`setTaskAssigneeAction: customer read failed: ${error.message}`);
  return (data as { assigned_to: string | null } | null)?.assigned_to !== assignee;
}
