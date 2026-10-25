// S-47e (spec 5.4.1): the per-call identity helpers. Pure. Only ids and counters.
import type { CallState, IdentityConfirmed } from "../call-state";
import type { Rung } from "./ladder";

export const MAX_MISSES = 2;

export function withConfirmed(state: CallState, c: IdentityConfirmed): CallState {
  return { ...state, identity: { ...state.identity, confirmed: { contactId: c.contactId, rung: c.rung, by: c.by } } };
}
/** One try that confirmed nobody; the second locks ("misses"). A confirmation made by a name (or a name and an
 *  email) is cleared: the caller has just asked about someone else, so the person confirmed before is no longer
 *  who this call is about (Task 6 review ruling, plan P25). One made by the caller ID alone stays. */
export function withMiss(state: CallState): CallState {
  const misses = state.identity.misses + 1;
  const prior = state.identity.confirmed;
  const confirmed = prior !== null && prior.by !== "caller_id" ? null : prior;
  return { ...state, identity: { ...state.identity, confirmed, misses, locked: state.identity.locked ?? (misses >= MAX_MISSES ? "misses" : null) } };
}
/** The first lock wins; a call never changes why it was locked. */
export function withLocked(state: CallState, why: "misses" | "cannot"): CallState {
  return state.identity.locked ? state : { ...state, identity: { ...state.identity, locked: why } };
}
export function withMessageNameAsked(state: CallState): CallState {
  return state.identity.messageNameAsked ? state : { ...state, identity: { ...state.identity, messageNameAsked: true } };
}
export function withLeadWhoseAsked(state: CallState): CallState {
  return state.identity.leadWhoseAsked ? state : { ...state, identity: { ...state.identity, leadWhoseAsked: true } };
}
export function isLocked(state: CallState): boolean {
  return state.identity.locked !== null;
}
/** The confirmation is this contact's, at the rung asked or above. No action asks rung 0 of an existing
 *  appointment, so 0 reads as 1 (the stricter); rung 3 is unreachable, so it is never met. */
export function confirmedFor(state: CallState, contactId: string, required: Rung): boolean {
  const r = required === 0 ? 1 : required;
  const c = state.identity.confirmed;
  return c !== null && r <= 2 && c.contactId === contactId && c.rung >= r;
}
