import {
  appendConsentEventGuarded, readConsentHistory, readConsentEvent, newestDecidingRow,
  completeTasksForConsentEvents, reopenTasks,
  type ConsentAction, type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { textsViewOf, RESUMABLE_METHODS, type TextsView } from "./texts-view";

/**
 * The staff controls of spec §4.2 ("Staff controls") and §6, behind the
 * server actions in contacts/texts-actions.ts and tasks/actions.ts. Every
 * write is a compare-and-set on the newest deciding row the operator SAW
 * (`{ ifNewest }`, plan G6): a stale click — the customer texted STOP while
 * the drawer was open — is refused and answered with where things stand now,
 * never applied over a customer's own stop (choice 19).
 */
export type TextsUndo =
  | { kind: "stop"; eventId: string }
  | { kind: "decision"; eventId: string; reopenTaskIds: string[] };

export type TextsActionResult =
  | { ok: true; view: TextsView; undo?: TextsUndo }
  | { ok: false; error: string; view?: TextsView };

export type TextsContext = {
  /** The request's RLS client: reads the ledger (SELECT under RLS) and writes tasks. */
  db: SupabaseClient;
  /** The service client: the ledger's only writer (0054, 0055). */
  writer: SupabaseClient;
  accountId: string;
  contactId: string;
  userId: string;
  actorName: string | null;
  /** The contact's number, E.164: the ledger's key. */
  address: string;
  unconfirmed: boolean;
  /** The request's clock, for the Undo window. */
  now: Date;
};

/**
 * How long an Undo stays an Undo (review R3-I6). The toast that offers it
 * lives a few seconds; two minutes covers a slow network without letting an
 * Undo become a note-free Resume. Past it, or for someone else's row, staff
 * use Stop texts or Resume texts (with its note), like any other change.
 */
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

/** Is this the operator's own row, young enough to undo? Pure. */
function undoable(ctx: TextsContext, row: { actor_id: string | null; occurred_at: string }): boolean {
  const age = ctx.now.getTime() - Date.parse(row.occurred_at);
  return row.actor_id === ctx.userId && Number.isFinite(age) && age < UNDO_WINDOW_MS;
}
const undoExpired = (): TextsActionResult => ({ ok: false, error: m["contact.texts.undoExpired"] });

const history = (ctx: TextsContext): Promise<ConsentHistoryRow[]> => readConsentHistory(ctx.db, ctx.accountId, "sms", ctx.address);
const view = async (ctx: TextsContext): Promise<TextsView> => textsViewOf(await history(ctx), { unconfirmed: ctx.unconfirmed });
const heldIds = (rows: readonly ConsentHistoryRow[]) => rows.filter((r) => r.action === "held").map((r) => r.id);

async function changed(ctx: TextsContext): Promise<TextsActionResult> {
  try {
    return { ok: false, error: m["contact.texts.changed"], view: await view(ctx) };
  } catch {
    return { ok: false, error: m["contact.texts.changed"] };
  }
}

async function guarded(label: string, ctx: TextsContext, work: () => Promise<TextsActionResult>): Promise<TextsActionResult> {
  try {
    return await work();
  } catch (e) {
    console.error(`${label}: account ${ctx.accountId} contact ${ctx.contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.texts.failed"] };
  }
}

/** One ledger row, compare-and-set on `expect`. The new row's id, or null when the newest row moved. */
async function write(
  ctx: TextsContext, e: { action: ConsentAction; method: ConsentMethod; note?: string; evidence?: Record<string, unknown> },
  expect: string | null,
): Promise<string | null> {
  const r = await appendConsentEventGuarded(ctx.writer, {
    accountId: ctx.accountId, channel: "sms", address: ctx.address, contactId: ctx.contactId,
    action: e.action, method: e.method, actorId: ctx.userId, note: e.note ?? null,
    evidence: { ...(e.evidence ?? {}), ...(ctx.actorName ? { actorName: ctx.actorName } : {}) },
  }, { ifNewest: expect });
  return r.outcome === "appended" ? r.id : null;
}

/** Closing a hold's To-dos is bookkeeping: a failure there is logged, never a failed decision. */
async function closeHoldTodos(ctx: TextsContext, rows: readonly ConsentHistoryRow[]): Promise<string[]> {
  try {
    return await completeTasksForConsentEvents(ctx.db, ctx.accountId, heldIds(rows), ctx.userId);
  } catch (e) {
    console.error(`consent To-dos for contact ${ctx.contactId} not closed: ${loggableError(e)}`);
    return [];
  }
}

/**
 * "Stop texts": revoked / staff, at once, with an Undo — only over an ALLOWED
 * address (no deciding row, a resubscribe or a release). 0055 enforces the
 * same rule inside its lock (review R3-C1); this read answers the operator
 * with where things stand instead of a bare refusal. A stop already stands,
 * and a hold is decided by Confirm stop / Not a stop.
 */
export function stopTexts(ctx: TextsContext, expectNewest: string | null): Promise<TextsActionResult> {
  return guarded("stopTexts", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if ((newest?.id ?? null) !== expectNewest || (newest !== null && newest.action !== "resubscribed" && newest.action !== "hold_released")) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "revoked", method: "staff" }, expectNewest);
    if (!id) return changed(ctx);
    return { ok: true, view: await view(ctx), undo: { kind: "stop", eventId: id } };
  });
}

/** The Undo of "Stop texts": only that staff stop, and only while it is still the newest row. */
export function undoStopTexts(ctx: TextsContext, eventId: string): Promise<TextsActionResult> {
  return guarded("undoStopTexts", ctx, async () => {
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    if (!row || row.address !== ctx.address || row.action !== "revoked" || row.method !== "staff") return changed(ctx);
    if (!undoable(ctx, row)) return undoExpired();
    const id = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

/** "Resume texts" with the required note: only a stop staff may lift (choice 19). */
export async function resumeTexts(ctx: TextsContext, expectEventId: string, note: string): Promise<TextsActionResult> {
  const text = note.trim();
  if (!text) return { ok: false, error: m["contact.texts.resumeNoteRequired"] };
  return guarded("resumeTexts", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if (!newest || newest.id !== expectEventId || newest.action !== "revoked" || !RESUMABLE_METHODS.includes(newest.method)) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "resubscribed", method: "staff", note: text.slice(0, 500) }, expectEventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

async function decideHold(
  label: string, ctx: TextsContext, holdEventId: string,
  e: (hold: ConsentHistoryRow) => { action: ConsentAction; method: ConsentMethod; evidence: Record<string, unknown> },
): Promise<TextsActionResult> {
  return guarded(label, ctx, async () => {
    const rows = await history(ctx);
    const hold = newestDecidingRow(rows);
    if (!hold || hold.id !== holdEventId || hold.action !== "held") return changed(ctx);
    const id = await write(ctx, e(hold), holdEventId);
    if (!id) return changed(ctx);
    const reopenTaskIds = await closeHoldTodos(ctx, rows);
    return { ok: true, view: await view(ctx), undo: { kind: "decision", eventId: id, reopenTaskIds } };
  });
}

const what = (row: { evidence: Record<string, unknown> }) => ({ phrase: row.evidence.phrase ?? null, excerpt: row.evidence.excerpt ?? null });

/** "Confirm stop": the hold becomes revoked / free_text, carrying what they wrote. */
export function confirmStop(ctx: TextsContext, holdEventId: string): Promise<TextsActionResult> {
  return decideHold("confirmStop", ctx, holdEventId, (hold) => ({
    action: "revoked", method: "free_text", evidence: { confirms: holdEventId, ...what(hold) },
  }));
}

/** "Not a stop": hold_released / staff (spec §3's guarded write, 0055). */
export function notAStop(ctx: TextsContext, holdEventId: string): Promise<TextsActionResult> {
  return decideHold("notAStop", ctx, holdEventId, (hold) => ({
    action: "hold_released", method: "staff", evidence: { releases: holdEventId, ...what(hold) },
  }));
}

/** The Undo of either: held / staff_undo, back On hold (spec §4.2), and the To-dos it closed reopened. */
export function undoHoldDecision(ctx: TextsContext, eventId: string, reopenTaskIds: readonly string[]): Promise<TextsActionResult> {
  return guarded("undoHoldDecision", ctx, async () => {
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    const isDecision = !!row && row.address === ctx.address
      && ((row.action === "revoked" && row.method === "free_text") || (row.action === "hold_released" && row.method === "staff"));
    if (!row || !isDecision) return changed(ctx);
    if (!undoable(ctx, row)) return undoExpired();
    const id = await write(ctx, { action: "held", method: "staff_undo", evidence: { undoes: eventId, ...what(row) } }, eventId);
    if (!id) return changed(ctx);
    try {
      await reopenTasks(ctx.db, ctx.accountId, reopenTaskIds, ctx.userId);
    } catch (e) {
      console.error(`consent To-dos for contact ${ctx.contactId} not reopened: ${loggableError(e)}`);
    }
    return { ok: true, view: await view(ctx) };
  });
}
