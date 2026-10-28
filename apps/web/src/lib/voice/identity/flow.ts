// S-47e (spec 5.4.2, 5.10.5; plan P10): the identity steps of find_my_booking, confirm_identity, the move/cancel
// ownership check and take_message's name ask. Every read is the caller's; this decides. Pure: registry.ts and
// the corpus stub (modules/corpus-lib.ts) run exactly this, so a corpus run cannot pass the ladder vacuously (O2).
import type { CallState } from "../call-state";
import { isCallerIdNumber } from "../phone-number";
import { isPlaceholderName } from "../tools/placeholders";
import type { Rung } from "./ladder";
import { decideIdentity, type Candidate, type Decision } from "./match";
import { withConfirmed, withMiss, withLocked, withMessageNameAsked, isLocked, confirmedFor } from "./state";
import {
  ASK_NAME, ASK_NAME_AND_EMAIL, ASK_NAME_AGAIN, ASK_EMAIL, CONFIRMED, MISS, LOCKED, CANNOT, NOT_CONFIRMED_YET,
  MESSAGE_ASK_NAME, lockedResult, readFailed, notTheirs, type ToolResult,
} from "./results";

export type CandidateRead = { ok: true; candidates: readonly Candidate[]; truncated: boolean } | { ok: false };
/** `event` is the spec 5.9 log line's tail, or null when nothing worth a line happened. */
export type Step = { state: CallState; result: ToolResult; event: string | null };
export type FindStep = ({ kind: "answer" } & Step)
  | { kind: "lookup"; state: CallState; contactId: string; by: "caller_id" | "name" | "name_email"; event: string | null };

/** No action requires rung 0 or rung 3 for an existing appointment (ladder.ts); 0 reads as 1, the stricter. */
function need(required: Rung): 1 | 2 | 3 {
  return required >= 3 ? 3 : required === 2 ? 2 : 1;
}
function confirmedEvent(d: Extract<Decision, { kind: "confirmed" }>): string {
  return `confirmed rung ${d.rung} by ${d.by === "caller_id" ? "caller-id" : d.by === "name" ? "name" : "name-email"}`;
}

export function findNeedsRead(state: CallState, required: Rung): boolean {
  if (isLocked(state) || need(required) === 3) return false;
  const c = state.identity.confirmed;
  return !(c !== null && c.rung >= need(required));
}

/** find_my_booking after its two caller-ID refusals (registry.ts keeps those). `read` is null when
 *  findNeedsRead said no read was needed. */
export function findStep(state: CallState, required: Rung, read: CandidateRead | null, next: string): FindStep {
  if (isLocked(state)) return { kind: "answer", state, result: lockedResult(state.identity.locked!), event: null };
  const r = need(required);
  if (r === 3) return { kind: "answer", state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
  const c = state.identity.confirmed;
  if (c !== null && c.rung >= r) return { kind: "lookup", state, contactId: c.contactId, by: c.by, event: null };
  if (read === null || !read.ok) return { kind: "answer", state, result: readFailed(next), event: "read failed" };
  const d = decideIdentity({ candidates: read.candidates, truncated: read.truncated, required: r });
  if (d.kind === "none") return { kind: "answer", state, result: { found: false }, event: null };
  if (d.kind === "confirmed") return { kind: "lookup", state: withConfirmed(state, d), contactId: d.contactId, by: d.by, event: confirmedEvent(d) };
  if (d.kind === "cannot_on_this_call") return { kind: "answer", state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
  return { kind: "answer", state, result: r === 2 ? ASK_NAME_AND_EMAIL : ASK_NAME, event: null };
}

/** confirm_identity after its caller-ID refusal and its locked check (registry.ts makes no read when locked). */
export function confirmStep(
  state: CallState, required: Rung, read: CandidateRead, args: { fullName?: unknown; email?: unknown }, next: string,
): Step {
  if (isLocked(state)) return { state, result: lockedResult(state.identity.locked!), event: null };
  const r = need(required);
  if (r === 3) return { state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
  if (!read.ok) return { state, result: readFailed(next), event: "read failed" };
  const d = decideIdentity({
    candidates: read.candidates, truncated: read.truncated, required: r,
    fullName: typeof args.fullName === "string" ? args.fullName : "",
    email: typeof args.email === "string" ? args.email : null,
  });
  switch (d.kind) {
    case "confirmed": return { state: withConfirmed(state, d), result: CONFIRMED, event: confirmedEvent(d) };
    case "ask_name": return { state, result: ASK_NAME_AGAIN, event: null };
    case "ask_email": return { state, result: ASK_EMAIL, event: null };
    case "cannot_on_this_call": return { state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
    default: {
      // "none" (nobody on the number) and "miss": a well-shaped try that confirmed nobody (spec S5).
      const after = withMiss(state);
      return isLocked(after)
        ? { state: after, result: LOCKED, event: "locked (misses)" }
        : { state: after, result: MISS, event: `miss ${after.identity.misses}` };
    }
  }
}

/** reschedule_appointment / cancel_appointment, after registry.ts's one contact read (spec 5.4.2; plan P7). */
export function ownsStep(
  state: CallState, required: Rung,
  b: { bookingId: string; contactId: string; contactPhone: string | null | undefined; callerNumber: string | null },
  next: string,
): { owned: true } | { owned: false; result: ToolResult } {
  if (state.bookings.some((x) => x.id === b.bookingId)) return { owned: true };          // rung 0: made on this call
  if (isLocked(state)) return { owned: false, result: lockedResult(state.identity.locked!) };
  if (confirmedFor(state, b.contactId, required) && isCallerIdNumber(b.contactPhone, b.callerNumber)) {
    return { owned: true };
  }
  const c = state.identity.confirmed;
  if (c === null || c.contactId === b.contactId) return { owned: false, result: NOT_CONFIRMED_YET };
  return { owned: false, result: notTheirs(next) };
}

/** The name the caller gave take_message, whitespace collapsed; null when none — a placeholder ("Unknown",
 *  "Desconocido", "Unknown Caller"…) is the same as none (contact-archive spec §7.3): Sofía heard it, but it is
 *  not a name worth storing. */
export function messageName(args: { name?: unknown }): string | null {
  const n = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim() : "";
  return n.length > 0 && !isPlaceholderName(n) ? n : null;
}
/** Whether take_message must read the number before recording (spec 5.10.5; plan P6: asks once per call). Never
 *  on a locked call (owner decision 2026-10-26): its message files on no customer, so a name would pick nothing. */
export function messageNeedsNameCheck(
  state: CallState, callerNumber: string | null, args: { name?: unknown; nameDeclined?: unknown },
): boolean {
  return callerNumber !== null && !isLocked(state) && state.identity.confirmed === null && !state.identity.messageNameAsked
    && messageName(args) === null && args.nameDeclined !== true;
}
/** The refusal on a shared number, or null to record the message (a failed read records it: a message is
 *  never lost on our outage, spec 5.10.5). */
export function messageNameStep(state: CallState, read: CandidateRead): Step | null {
  if (!read.ok) return null;
  if (!read.truncated && read.candidates.length < 2) return null;
  return { state: withMessageNameAsked(state), result: MESSAGE_ASK_NAME, event: null };
}
