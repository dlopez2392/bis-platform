import { cache } from "react";
import {
  getVoiceProfile, getVoiceProfileAnyStatusByPublicId, isConciergeLive, listPhoneNumbersForAccount,
  type A2pStatus, type PhoneNumberStatus,
} from "@bis/db";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { voiceBlock, type BillingVerdict } from "@/lib/billing/standing";
import { dbForRequest } from "@/lib/db";
import { sofiaGate } from "@/lib/vetting/trades";
import { callAnswerable } from "@/lib/voice/accept-gate";

/**
 * F-088 PR 1, the grade (brief `.superpowers/sdd/f088-brief.md` §3; principle 6, `docs/crm-features.md`
 * 2519-2523). A CAPABILITY is what a plan or a setup step turns on. Each is graded into exactly one of the
 * five surface states, with a reason the words (PR 2) and the upgrade page (PR 3) are written from.
 *
 * DISPLAY ONLY, NEVER AUTHORISATION, like the manifest it annotates: the TeXML route, the concierge and the
 * send gate keep their own checks. The grade only has to agree with them, which is why it reads the SAME
 * `billingVerdictFor` they enforce, never `accounts.permissions` (a mirror that says "no Sofía" while the
 * switch is off, when she does answer). Switch off, nobody is "in a bigger plan", which is true.
 *
 * Precedence, so the screen never contradicts what a caller hears: what actually runs is LIVE first,
 * whatever the trade says (the trade gate only refuses a switch-ON; sofia-guard.ts names the race that can
 * leave a CRM-only company answering). Then a CRM-only trade is ABSENT (no plan would change it), a paused
 * account is WAITING on its payment (billing, not plan: the paused banner says the rest), a plan without
 * it is a BIGGER PLAN, and everything else NEEDS SETUP. Texting depends on the carriers' registration
 * only: every plan and every trade texts.
 */
export const CAPABILITIES = ["sofia", "webChat", "texting"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityStateName = "live" | "needs_setup" | "waiting" | "bigger_plan" | "absent";
export type CapabilityReason =
  | "sofia_answering" | "sofia_testing" | "calls_forwarded" | "chat_open" | "texting_registered"
  | "read_failed" | "no_trade" | "sofia_off" | "no_number" | "chat_off" | "not_registered" | "registration_rejected"
  | "billing_paused" | "billing_ended" | "carrier_review"
  | "plan_no_voice" | "plan_no_chat"
  | "crm_only_trade";
export type CapabilityGrade = { state: CapabilityStateName; reason: CapabilityReason };

/** What the grade needs, read once per request. "failed" grades every capability needs_setup, never live. */
export type CapabilityFacts =
  | { read: "failed" }
  | {
      read: "ok";
      /** `cause` is billingVerdictFor's: a paused account whose plan ENDED is not waiting on a payment. */
      verdict: BillingVerdict & { cause?: "payment" | "ended" | null };
      trade: string | null;
      /** The voice profile as callAnswerable reads it; null = none. `forwardCalls` is voice_profiles.forward_calls:
       *  the route sends a cleared call to the transfer number instead of Sofía (route.ts ~1110), and the
       *  forwarded call is recorded in forwarded_calls, never in `calls`. */
      profile: { enabled: boolean; forwardCalls?: boolean } | null;
      /** Every phone number of the account, by status. */
      numberStatuses: PhoneNumberStatus[];
      /** isConciergeLive: on, with a published destination of this account (the verdict is applied here). */
      conciergeLive: boolean;
      a2pStatus: A2pStatus;
    };

const grade = (state: CapabilityStateName, reason: CapabilityReason): CapabilityGrade => ({ state, reason });

/** The statuses a call to one of the numbers would be answered on, asked exactly as the TeXML route asks:
 *  only testing and live numbers reach the gate (route.ts's own filter), then the ONE shared predicate. */
function answeringStatuses(facts: Extract<CapabilityFacts, { read: "ok" }>): PhoneNumberStatus[] {
  return facts.numberStatuses.filter((status) =>
    (status === "testing" || status === "live") && callAnswerable({ status, profile: facts.profile }).answerable);
}

/** A pause because the plan ended reads "ended", never "until the payment is settled" (billing/page.tsx's own split). */
const pausedReason = (v: { cause?: "payment" | "ended" | null }): CapabilityReason => (v.cause === "ended" ? "billing_ended" : "billing_paused");

export function capabilityState(cap: Capability, facts: CapabilityFacts): CapabilityGrade {
  if (facts.read === "failed") return grade("needs_setup", "read_failed");
  if (cap === "texting") {
    switch (facts.a2pStatus) {
      case "approved": return grade("live", "texting_registered");
      case "pending": return grade("waiting", "carrier_review");
      case "rejected": return grade("needs_setup", "registration_rejected");
      default: return grade("needs_setup", "not_registered");
    }
  }
  const { verdict } = facts;
  const gate = sofiaGate(facts.trade);
  if (cap === "sofia") {
    // The TeXML route's questions in its order: a number that answers (callAnswerable: a testing number
    // answers even with the profile off), then billing (voiceBlock null = the call is Sofía's).
    const block = voiceBlock(verdict);
    const answering = answeringStatuses(facts);
    if (block === null && answering.length > 0) {
      // After billing and before the bridge, as the route orders them: with forward_calls on, a cleared call
      // rings the transfer number and Sofía never hears it, so she is not "answering" whatever the numbers say.
      if (facts.profile?.forwardCalls === true) return grade("needs_setup", "calls_forwarded");
      return grade("live", answering.includes("live") ? "sofia_answering" : "sofia_testing");
    }
    if (!gate.ok && gate.reason === "crm_only") return grade("absent", "crm_only_trade");
    if (block?.reason === "billing-paused") return grade("waiting", pausedReason(verdict));
    if (block?.reason === "plan-no-voice") return grade("bigger_plan", "plan_no_voice");
    if (!gate.ok) return grade("needs_setup", "no_trade");
    return grade("needs_setup", facts.profile?.enabled === true ? "no_number" : "sofia_off");
  }
  // conciergeOpen's own question: isConciergeLive AND the verdict's concierge.
  if (facts.conciergeLive && verdict.concierge) return grade("live", "chat_open");
  if (!gate.ok && gate.reason === "crm_only") return grade("absent", "crm_only_trade");
  if (verdict.paused) return grade("waiting", pausedReason(verdict));
  if (!verdict.concierge) return grade("bigger_plan", "plan_no_chat");
  return grade("needs_setup", gate.ok ? "chat_off" : "no_trade");
}

type Stage = "client" | "other" | "accounts" | "no_row" | "voice_profile" | "number" | "billing" | "chat";
/** A read that failed, tagged with WHERE; carries the original error's class only, never its message. */
class FactsReadFailed extends Error {
  constructor(readonly stage: Stage, readonly kind: string) { super(stage); }
}
function at<T>(stage: Stage, p: PromiseLike<T>): Promise<T> {
  return Promise.resolve(p).catch((e: unknown) => {
    throw new FactsReadFailed(stage, e instanceof Error ? e.constructor.name : typeof e);
  });
}

/**
 * The facts for THIS request (React cache). Call it only after the page's own guard
 * (requireAccountAccess or stricter) ran: the account's rows are read on the caller's own client
 * (dbForRequest, RLS on; every member may read accounts, voice_profiles, phone_numbers and forms), and the
 * billing verdict through billingVerdictFor, the one cached service read the paused banner and the
 * concierge already share.
 *
 * Any failed or missing read is { read: "failed" }, logged with a stage tag and the error's CLASS only: a
 * PostgREST message can quote a value, and this log line needs none. billingVerdictFor fails open on its
 * own (nothing paused), exactly as the paths it mirrors do, so a billing read error rarely reaches here.
 */
export const readCapabilityFacts = cache(async (accountId: string): Promise<CapabilityFacts> => {
  try {
    const db = await at("client", dbForRequest());
    const [account, profile, numbers, verdict] = await Promise.all([
      at("accounts", db.from("accounts").select("trade, a2p_status").eq("id", accountId).maybeSingle()),
      at("voice_profile", getVoiceProfile(db, accountId)),
      at("number", listPhoneNumbersForAccount(db, accountId)),
      at("billing", billingVerdictFor(accountId)),
    ]);
    if (account.error) throw new FactsReadFailed("accounts", "PostgrestError");
    if (!account.data) throw new FactsReadFailed("no_row", "null");
    const row = account.data as { trade: string | null; a2p_status: A2pStatus };
    // The destination's publication is only on the by-public-id read (its embed); skipped when the chat is off.
    const chat = profile?.public_id && profile.concierge_enabled && profile.concierge_form_id
      ? await at("chat", getVoiceProfileAnyStatusByPublicId(db, profile.public_id))
      : null;
    return {
      read: "ok",
      verdict,
      trade: row.trade ?? null,
      profile: profile ? { enabled: profile.enabled === true, forwardCalls: profile.forward_calls === true } : null,
      numberStatuses: numbers.map((n) => n.status),
      // Defensive guard: public_id is unique, so this row is the account's own; never trust it unchecked.
      conciergeLive: chat !== null && chat.account_id === accountId && isConciergeLive(chat),
      a2pStatus: row.a2p_status,
    };
  } catch (e) {
    const failed = e instanceof FactsReadFailed ? e : new FactsReadFailed("other", e instanceof Error ? e.constructor.name : typeof e);
    console.error(`capability facts read failed for account ${accountId} at ${failed.stage}; graded needs_setup: ${failed.kind}`);
    return { read: "failed" };
  }
});
