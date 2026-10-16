import {
  appendConsentEventGuarded, readConsentHistory, readConsentEvent, newestDecidingRow,
  type ConsentAction, type ConsentAppend, type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
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
  // `expired` (fix round 1 item 4): set only by undoInboundStop's own 7-day-window refusal, so a
  // caller branches on the FIELD, never on matching the (translatable) error string.
  | { ok: false; error: string; view?: EmailView; expired?: boolean };

export type EmailContext = {
  /** The request's RLS client: proved the contact (emailContextFor). */
  db: SupabaseClient;
  /** The service client: the ledger's only writer (0054, 0055), and since F-085
   *  the client the address's HISTORY is read through (spec §7.3) — consent is
   *  keyed by address, so a Technician's RLS client would see only part of it. */
  writer: SupabaseClient;
  accountId: string;
  contactId: string;
  userId: string;
  actorName: string | null;
  /** The contact's address as the ledger keys it (emailLedgerAddress). */
  address: string;
  now: Date;
};

// By address, on the service client (F-085, spec §7.3): the contact was proven on ctx.db first.
const history = (ctx: EmailContext): Promise<ConsentHistoryRow[]> => readConsentHistory(ctx.writer, ctx.accountId, "email", ctx.address);
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

/** THE one argument-building call every write in this file makes (fix round 1 item 5: both
 *  `appendConsentEventGuarded` callers below used to build this object twice, independently).
 *  Returns the full `ConsentAppend` — not just an id — so a caller that needs the `prior` row
 *  on a refusal (undoInboundStop's 7-day-window check) does not re-issue the same call. */
async function write(
  ctx: EmailContext, e: { action: ConsentAction; method: ConsentMethod; note?: string; evidence?: Record<string, unknown> },
  expect: string | null,
): Promise<ConsentAppend> {
  return appendConsentEventGuarded(ctx.writer, {
    accountId: ctx.accountId, channel: "email", address: ctx.address, contactId: ctx.contactId,
    action: e.action, method: e.method, actorId: ctx.userId, note: e.note ?? null,
    evidence: { ...(e.evidence ?? {}), ...(ctx.actorName ? { actorName: ctx.actorName } : {}) },
  }, { ifNewest: expect });
}

/** "Stop emails": revoked / staff, at once, with an Undo — only over an allowed address. */
export function stopEmails(ctx: EmailContext, expectNewest: string | null): Promise<EmailActionResult> {
  return guarded("stopEmails", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if ((newest?.id ?? null) !== expectNewest || (newest !== null && newest.action !== "resubscribed" && newest.action !== "hold_released")) {
      return changed(ctx);
    }
    const r = await write(ctx, { action: "revoked", method: "staff" }, expectNewest);
    if (r.outcome !== "appended") return changed(ctx);
    return { ok: true, view: await view(ctx), undo: { kind: "stop", eventId: r.id } };
  });
}

/** The Undo of "Stop emails": only that staff member's own stop, young, still newest. */
export function undoStopEmails(ctx: EmailContext, eventId: string): Promise<EmailActionResult> {
  return guarded("undoStopEmails", ctx, async () => {
    // On ctx.db, deliberately: an Undo acts only on this caller's own row (actor_id is
    // checked below), written against ctx.contactId, the contact emailContextFor proved,
    // so the caller's own client sees it; a row it cannot see is not theirs to undo.
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    if (!row || row.channel !== "email" || row.address !== ctx.address || row.action !== "revoked" || row.method !== "staff") return changed(ctx);
    if (!undoable(ctx, row)) return { ok: false, error: m["contact.email.undoExpired"] };
    const r = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    return r.outcome === "appended" ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

/** The emailed clear stop (S-06 part 1): revoked / inbound_email over an ALLOWED address only (plan G3),
 *  idempotent on Resend's id. THROWS on a ledger error: the webhook answers 503 and Resend retries. */
export type InboundStopResult = { outcome: "stopped"; eventId: string } | { outcome: "already_stopped" };

export async function recordInboundStop(
  writer: SupabaseClient, i: { accountId: string; contactId: string; address: string; providerEmailId: string; phrase: string },
): Promise<InboundStopResult> {
  const r = await appendConsentEventGuarded(writer, {
    accountId: i.accountId, channel: "email", address: i.address, action: "revoked", method: "inbound_email",
    contactId: i.contactId, actorId: null, sourceRef: `inbound_email:${i.providerEmailId}`,
    evidence: { inbound_email_id: i.providerEmailId, phrase: i.phrase },
  }, "if_allowed");
  return r.outcome === "refused" ? { outcome: "already_stopped" } : { outcome: "stopped", eventId: r.id };
}

/**
 * The Undo of an emailed stop (0082): only that inbound_email stop, while it is still the newest row.
 * Any member may run it (no actor_id check — nobody "claims" a webhook-recorded stop the way a staff
 * action is claimed). Past the owner's 7-day window (0082's function), the ledger answers `refused`
 * with the SAME row still as `prior` (same id, method inbound_email): that is the expired state, not
 * a generic "someone else changed this" — shown with its own explanation, never thrown as an error.
 */
export function undoInboundStop(ctx: EmailContext, eventId: string): Promise<EmailActionResult> {
  return guarded("undoInboundStop", ctx, async () => {
    // On ctx.writer, deliberately: the stop's actor_id is null and its contact may be a household
    // member the caller's Technician RLS cannot see; the caller proved the THREAD's contact first.
    const row = await readConsentEvent(ctx.writer, ctx.accountId, eventId);
    if (!row || row.channel !== "email" || row.address !== ctx.address || row.action !== "revoked" || row.method !== "inbound_email") return changed(ctx);
    const r = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    if (r.outcome === "appended") return { ok: true, view: await view(ctx) };
    // Fix round 1 item 3: the SAME row, still newest, refused ONLY because 0082's 7-day window
    // has closed — not merely "some inbound_email row" (a different, newer stop would also be
    // `method: 'inbound_email'` but is a stale click, not an expiry).
    if (r.outcome === "refused" && r.prior && r.prior.id === eventId && r.prior.method === "inbound_email") {
      return { ok: false, error: m["contact.email.replyExpiredExplain"], expired: true };
    }
    return changed(ctx);
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
    const r = await write(ctx, { action: "resubscribed", method: "staff", note: text.slice(0, 500) }, expectEventId);
    return r.outcome === "appended" ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}
