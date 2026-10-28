import type { PhoneNumberStatus } from "@bis/db";
import { callAnswerable } from "@/lib/voice/accept-gate";

/** A voice profile as far as answering and the chat care; null = no profile row. */
export type SofiaProfileState = { enabled?: boolean | null; concierge_enabled?: boolean | null } | null;
export type SofiaSnapshot = { profile: SofiaProfileState; numbers: readonly { status: PhoneNumberStatus }[] };

/**
 * Whether Sofía is answering, and whether the web chat is on, for one company. "Answering" is the call
 * path's own rule (callAnswerable, accept-gate.ts: a testing number answers whatever profile.enabled says,
 * a live one only when enabled, nothing without a profile), over every number that can take a call. Pure.
 */
export function sofiaIsOn(profile: SofiaProfileState, numbers: SofiaSnapshot["numbers"]): { answering: boolean; chat: boolean } {
  const p = profile ? { enabled: profile.enabled === true } : null;
  const answering = numbers.some((n) =>
    (n.status === "testing" || n.status === "live") && callAnswerable({ status: n.status, profile: p }).answerable);
  return { answering, chat: profile?.concierge_enabled === true };
}

/**
 * THE switch-on rule (S-53; plan review C1): a write switches Sofía or the web chat on exactly when it
 * takes answering, or the chat, from false to true. Every guarded action computes the state before and
 * the state it would write; everything else only subtracts at call time and never needs a trade.
 */
export function switchesSofiaOn(before: SofiaSnapshot, after: SofiaSnapshot): boolean {
  const b = sofiaIsOn(before.profile, before.numbers);
  const a = sofiaIsOn(after.profile, after.numbers);
  return (!b.answering && a.answering) || (!b.chat && a.chat);
}
