"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  clearAiActUndone, getAiAct, getContact, markAiActNotified, restoreContactFieldIf, serviceDb, stampAiActUndone,
  undoAiBookingAct, undoAiContactCreated, type AiBookingUndoOutcome,
} from "@bis/db";
import type { AiAct } from "@bis/db/ai-act-rules";
import { requireAccountAccess, requireAccountOwner } from "@/lib/auth";
import { callerCanSee } from "@/lib/auth/visible";
import { dbForRequest } from "@/lib/db";
import { originFrom } from "@/lib/email/origin";
import { loggableError } from "@/lib/loggable-error";
import type { ActReason } from "./kinds/types";
import { sendBookingUndoNotice } from "./notify";
import type { RedoResult, UndoResult } from "./undo-handlers";
import { typedNameMatches } from "./view";

/**
 * The Undo of one of Sofía's acts (item 8c, plan Task 5 item 4; spec 5.2). The order, every time:
 *   1. `requireAccountAccess` (outside any catch: its redirect is a signal Next must see);
 *   2. the act read on the REQUEST client (`getAiAct`: RLS and 0091's Technician fence are the proof that
 *      this reader may see it; another account's id, or an unassigned customer's, reads as nothing);
 *   3. the kind's own proof on the request client (every booking it names, `callerCanSee`; the field's own
 *      compare-and-swap, `restoreContactFieldIf`, which runs on the request client; the contact row);
 *   4. only then the SERVICE client: 0091's two functions, the act's stamp, the notice.
 * A booking undo ALWAYS goes through `undo_ai_booking_act` (its still-safe check and its write in one
 * transaction); a contact removal ALWAYS through `undo_ai_contact_created`; neither is ever re-done here.
 * The display's `stillSafe` is never trusted: whatever it showed, the function or the compare-and-swap
 * decides. An act already undone is refused before anything is written, so no Undo runs twice.
 * Logs name ids and codes only.
 */

const recordPath = (accountId: string, contactId: string) => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
const log = (what: string, accountId: string, actId: string, e: unknown) =>
  console.error(`ai-acts: ${what} for act ${actId} (account ${accountId}): ${loggableError(e)}`);

/** A revalidation that fails is logged, never reported: the undo already stands. */
function revalidate(paths: string[], accountId: string, actId: string): void {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch (e) {
      log("revalidatePath failed", accountId, actId, e);
    }
  }
}

const BOOKING_REASON: Readonly<Record<Exclude<AiBookingUndoOutcome, "undone">, ActReason | "notAvailable">> = {
  already_cancelled: "alreadyCancelled", already_happened: "alreadyHappened", rebooked: "rebooked",
  time_passed: "timePassed", time_taken: "timeTaken", old_time_taken: "oldTimeTaken", changed: "changed",
  already_undone: "notAvailable", gone: "notAvailable",
};

const NOT_AVAILABLE = { ok: false, reason: "notAvailable" } as const;

export async function undoAiActAction(
  accountId: string, actId: string, input: { notify?: boolean; typedName?: string } = {},
): Promise<UndoResult> {
  const access = await requireAccountAccess(accountId);
  let act: AiAct | null;
  try {
    act = await getAiAct(await dbForRequest(), accountId, actId);
  } catch (e) {
    log("undo read failed", accountId, actId, e);
    return NOT_AVAILABLE;
  }
  if (!act || act.undoneAt) return NOT_AVAILABLE;

  if (act.kind === "contact_created") {
    // Deleting a customer is an Owner's (0066). Outside the catch below: a Staff member is redirected.
    await requireAccountOwner(accountId);
    return undoContact(accountId, act, input.typedName ?? "");
  }
  try {
    const result = act.kind === "contact_field_filled"
      ? await undoField(accountId, act, access.userId)
      : await undoBooking(accountId, act, access.userId, input.notify === true);
    if (result.ok) revalidate([recordPath(accountId, act.contactId)], accountId, actId);
    return result;
  } catch (e) {
    log("undo failed", accountId, actId, e);
    return NOT_AVAILABLE;
  }
}

async function undoBooking(
  accountId: string, act: Extract<AiAct, { kind: "booking_created" | "booking_cancelled" | "booking_rescheduled" }>,
  userId: string, notify: boolean,
): Promise<UndoResult> {
  const ids = act.kind === "booking_rescheduled" ? [act.target.bookingId, act.target.fromBookingId] : [act.target.bookingId];
  for (const id of ids) {
    if (!(await callerCanSee("bookings", accountId, id))) return NOT_AVAILABLE;
  }
  const writer = serviceDb();
  const outcome = await undoAiBookingAct(writer, accountId, act.id, userId, new Date());
  if (outcome !== "undone") return { ok: false, reason: BOOKING_REASON[outcome] };
  if (!notify) return { ok: true, control: "booking", told: "notAsked" };

  // Everything below runs AFTER the undo committed (review M-2): a failure here is "not told", never "not
  // undone". The record as this reader's own client sees it; no email on file means nobody was asked.
  try {
    const contact = (await getContact(await dbForRequest(), accountId, act.contactId)) as Record<string, unknown> | null;
    const email = typeof contact?.email === "string" && contact.email.trim() ? contact.email : null;
    if (!email) return { ok: true, control: "booking", told: "notAsked" };
    await sendBookingUndoNotice({
      db: writer, accountId, act,
      contact: { email, language: typeof contact?.language === "string" ? contact.language : null },
      origin: originFrom(await headers()),
    });
  } catch (e) {
    log("undo notice not sent", accountId, act.id, e);
    return { ok: true, control: "booking", told: "no" };
  }
  // The email went: a failure to record that is logged, never reported as "not told" (plan ambiguity K).
  try {
    await markAiActNotified(writer, accountId, act.id);
  } catch (e) {
    log("undo notice sent but not marked", accountId, act.id, e);
  }
  return { ok: true, control: "booking", told: "yes" };
}

async function undoField(
  accountId: string, act: Extract<AiAct, { kind: "contact_field_filled" }>, userId: string,
): Promise<UndoResult> {
  // The compare-and-swap on the request client: the field must still hold exactly her value.
  const r = await restoreContactFieldIf(await dbForRequest(), accountId, act.contactId, act.target.field, act.after.value, act.before.value, userId);
  if (r === "changed") return { ok: false, reason: "changed" };
  // The value is back: a stamp that fails now is logged by id, never reported as a failed Undo (review M-2).
  try {
    if (!(await stampAiActUndone(serviceDb(), accountId, act.id, userId, new Date()))) {
      // Another Undo stamped it between our read and our write; the value is back either way.
      console.error(`ai-acts: field act ${act.id} (account ${accountId}) was already stamped undone`);
    }
  } catch (e) {
    log("field restored but not stamped", accountId, act.id, e);
  }
  return { ok: true, control: "field" };
}

async function undoContact(accountId: string, act: Extract<AiAct, { kind: "contact_created" }>, typedName: string): Promise<UndoResult> {
  try {
    const contact = (await getContact(await dbForRequest(), accountId, act.contactId)) as Record<string, unknown> | null;
    if (!contact) return NOT_AVAILABLE;
    if (!typedNameMatches(typedName, contact)) return { ok: false, reason: "typedName" };
    const outcome = await undoAiContactCreated(serviceDb(), accountId, act.id);
    if (outcome === "has_activity") return { ok: false, reason: "hasActivity" };
    if (outcome === "has_booking") return { ok: false, reason: "hasBooking" };
    if (outcome !== "deleted") return NOT_AVAILABLE;
    revalidate([recordPath(accountId, act.contactId), `/dashboard/accounts/${accountId}/contacts`], accountId, act.id);
    return { ok: true, control: "contact", removed: true };
  } catch (e) {
    log("contact undo failed", accountId, act.id, e);
    return NOT_AVAILABLE;
  }
}

/**
 * The field toast's own Undo (plan ambiguity F): Sofía's value back over the old one, only while the field
 * still holds what this person's Undo put there and the act is still THEIR stamp; then the stamp is cleared
 * at its exact instant. A booking or a contact act is never redone (spec §3).
 */
export async function redoAiFieldFillAction(accountId: string, actId: string): Promise<RedoResult> {
  const access = await requireAccountAccess(accountId);
  try {
    const db = await dbForRequest();
    const act = await getAiAct(db, accountId, actId);
    if (!act || act.kind !== "contact_field_filled") return { ok: false, reason: "notAvailable" };
    if (!act.undoneAt) return { ok: false, reason: "changed" };
    if (act.undoneBy !== access.userId) return { ok: false, reason: "notAvailable" };
    const r = await restoreContactFieldIf(db, accountId, act.contactId, act.target.field, act.before.value, act.after.value, access.userId);
    if (r === "changed") return { ok: false, reason: "changed" };
    // Sofía's value is back: a failed clear is logged by id, never reported as a failed redo (review M-2's twin).
    try {
      if (!(await clearAiActUndone(serviceDb(), accountId, actId, access.userId, new Date(act.undoneAt)))) {
        console.error(`ai-acts: field act ${actId} (account ${accountId}) redone but its stamp had moved`);
      }
    } catch (e) {
      log("field redone but its stamp not cleared", accountId, actId, e);
    }
    revalidate([recordPath(accountId, act.contactId)], accountId, actId);
    return { ok: true };
  } catch (e) {
    log("redo failed", accountId, actId, e);
    return { ok: false, reason: "notAvailable" };
  }
}
