import {
  appendConsentEventGuarded, readConsentHistory, readConsentEvent, newestDecidingRow,
  type ConsentAction, type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { UNDO_WINDOW_MS } from "./staff-actions";
import { emailViewOf, EMAIL_RESUMABLE_METHODS, type EmailView } from "./email-view";

/**
 * The Email row's staff controls (spec §4.2 "Staff controls", for email;
 * §6). The Texts row's rules (PR-2's staff-actions.ts) on the email channel:
 * every write is a compare-and-set on the newest deciding row the operator
 * SAW, so a stale click — the customer unsubscribed while the drawer was open —
 * is refused and answered with where things stand; 0055 enforces choice 19's
 * staff rules inside its lock whatever this module checks.
 */
export type EmailUndo = { kind: "stop"; eventId: string };

export type EmailActionResult =
  | { ok: true; view: EmailView; undo?: EmailUndo }
  | { ok: false; error: string; view?: EmailView };

export type EmailContext = {
  /** The request's RLS client: reads the ledger. */
  db: SupabaseClient;
  /** The service client: the ledger's only writer (0054, 0055). */
  writer: SupabaseClient;
  accountId: string;
  contactId: string;
  userId: string;
  actorName: string | null;
  /** The contact's address as the ledger keys it (emailLedgerAddress). */
  address: string;
  now: Date;
};

const history = (ctx: EmailContext): Promise<ConsentHistoryRow[]> => readConsentHistory(ctx.db, ctx.accountId, "email", ctx.address);
const view = async (ctx: EmailContext): Promise<EmailView> => emailViewOf(await history(ctx), true);

function undoable(ctx: EmailContext, row: { actor_id: string | null; occurred_at: string }): boolean {
  const age = ctx.now.getTime() - Date.parse(row.occurred_at);
  return row.actor_id === ctx.userId && Number.isFinite(age) && age < UNDO_WINDOW_MS;
}

async function changed(ctx: EmailContext): Promise<EmailActionResult> {
  try {
    return { ok: false, error: m["contact.email.changed"], view: await view(ctx) };
  } catch (e) {
    console.error(`email row: account ${ctx.accountId} contact ${ctx.contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.email.changed"] };
  }
}

async function guarded(label: string, ctx: EmailContext, work: () => Promise<EmailActionResult>): Promise<EmailActionResult> {
  try {
    return await work();
  } catch (e) {
    console.error(`${label}: account ${ctx.accountId} contact ${ctx.contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.email.failed"] };
  }
}

async function write(
  ctx: EmailContext, e: { action: ConsentAction; method: ConsentMethod; note?: string; evidence?: Record<string, unknown> },
  expect: string | null,
): Promise<string | null> {
  const r = await appendConsentEventGuarded(ctx.writer, {
    accountId: ctx.accountId, channel: "email", address: ctx.address, contactId: ctx.contactId,
    action: e.action, method: e.method, actorId: ctx.userId, note: e.note ?? null,
    evidence: { ...(e.evidence ?? {}), ...(ctx.actorName ? { actorName: ctx.actorName } : {}) },
  }, { ifNewest: expect });
  return r.outcome === "appended" ? r.id : null;
}

/** "Stop emails": revoked / staff, at once, with an Undo — only over an allowed address. */
export function stopEmails(ctx: EmailContext, expectNewest: string | null): Promise<EmailActionResult> {
  return guarded("stopEmails", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if ((newest?.id ?? null) !== expectNewest || (newest !== null && newest.action !== "resubscribed" && newest.action !== "hold_released")) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "revoked", method: "staff" }, expectNewest);
    if (!id) return changed(ctx);
    return { ok: true, view: await view(ctx), undo: { kind: "stop", eventId: id } };
  });
}

/** The Undo of "Stop emails": only that staff member's own stop, young, still newest. */
export function undoStopEmails(ctx: EmailContext, eventId: string): Promise<EmailActionResult> {
  return guarded("undoStopEmails", ctx, async () => {
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    if (!row || row.channel !== "email" || row.address !== ctx.address || row.action !== "revoked" || row.method !== "staff") return changed(ctx);
    if (!undoable(ctx, row)) return { ok: false, error: m["contact.email.undoExpired"] };
    const id = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

/** "Resume emails" with the required note: only a stop staff may lift (choice 19). */
export async function resumeEmails(ctx: EmailContext, expectEventId: string, note: string): Promise<EmailActionResult> {
  const text = note.trim();
  if (!text) return { ok: false, error: m["contact.email.resumeNoteRequired"] };
  return guarded("resumeEmails", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if (!newest || newest.id !== expectEventId || newest.action !== "revoked" || !EMAIL_RESUMABLE_METHODS.includes(newest.method)) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "resubscribed", method: "staff", note: text.slice(0, 500) }, expectEventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}
