import { cache } from "react";
import { getVoiceProfile, getVoiceProfileAnyStatusByPublicId, isConciergeLive, type A2pStatus } from "@bis/db";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { voiceBlock, type BillingVerdict } from "@/lib/billing/standing";
import { dbForRequest } from "@/lib/db";
import { sofiaGate } from "@/lib/vetting/trades";

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
  | "sofia_answering" | "chat_open" | "texting_registered"
  | "read_failed" | "no_trade" | "sofia_off" | "chat_off" | "not_registered" | "registration_rejected"
  | "billing_paused" | "carrier_review"
  | "plan_no_voice" | "plan_no_chat"
  | "crm_only_trade";
export type CapabilityGrade = { state: CapabilityStateName; reason: CapabilityReason };

/** What the grade needs, read once per request. "failed" grades every capability needs_setup, never live. */
export type CapabilityFacts =
  | { read: "failed" }
  | {
      read: "ok";
      verdict: BillingVerdict;
      trade: string | null;
      /** voice_profiles.enabled: the switch Sofía answers on. */
      voiceProfileEnabled: boolean;
      /** isConciergeLive: on, with a published destination of this account (the verdict is applied here). */
      conciergeLive: boolean;
      a2pStatus: A2pStatus;
    };

const grade = (state: CapabilityStateName, reason: CapabilityReason): CapabilityGrade => ({ state, reason });

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
    // The TeXML route's own question: is this call Sofía's? (voiceBlock null = yes.)
    const block = voiceBlock(verdict);
    if (block === null && facts.voiceProfileEnabled) return grade("live", "sofia_answering");
    if (!gate.ok && gate.reason === "crm_only") return grade("absent", "crm_only_trade");
    if (block?.reason === "billing-paused") return grade("waiting", "billing_paused");
    if (block?.reason === "plan-no-voice") return grade("bigger_plan", "plan_no_voice");
    return grade("needs_setup", gate.ok ? "sofia_off" : "no_trade");
  }
  // conciergeOpen's own question: isConciergeLive AND the verdict's concierge.
  if (facts.conciergeLive && verdict.concierge) return grade("live", "chat_open");
  if (!gate.ok && gate.reason === "crm_only") return grade("absent", "crm_only_trade");
  if (verdict.paused) return grade("waiting", "billing_paused");
  if (!verdict.concierge) return grade("bigger_plan", "plan_no_chat");
  return grade("needs_setup", gate.ok ? "chat_off" : "no_trade");
}

/**
 * The facts for THIS request (React cache). Call it only after the page's own guard
 * (requireAccountAccess or stricter) ran: the account's rows are read on the caller's own client
 * (dbForRequest, RLS on; every member may read accounts, voice_profiles and forms), and the billing verdict
 * through billingVerdictFor, the one cached service read the paused banner and the concierge already share.
 *
 * Any failed or missing read is { read: "failed" }, logged with the error's CLASS only: a PostgREST message
 * can quote a value, and this log line needs none. billingVerdictFor fails open on its own (nothing paused),
 * exactly as the paths it mirrors do, so a billing read error never reaches this catch.
 */
export const readCapabilityFacts = cache(async (accountId: string): Promise<CapabilityFacts> => {
  try {
    const db = await dbForRequest();
    const [account, profile, verdict] = await Promise.all([
      db.from("accounts").select("trade, a2p_status").eq("id", accountId).maybeSingle(),
      getVoiceProfile(db, accountId),
      billingVerdictFor(accountId),
    ]);
    if (account.error) throw new Error("accounts read failed");
    if (!account.data) throw new Error("no accounts row");
    const row = account.data as { trade: string | null; a2p_status: A2pStatus };
    // The destination's publication is only on the by-public-id read (its embed); skipped when the chat is off.
    const chat = profile?.public_id && profile.concierge_enabled && profile.concierge_form_id
      ? await getVoiceProfileAnyStatusByPublicId(db, profile.public_id)
      : null;
    return {
      read: "ok",
      verdict,
      trade: row.trade ?? null,
      voiceProfileEnabled: profile?.enabled === true,
      conciergeLive: chat !== null && chat.account_id === accountId && isConciergeLive(chat),
      a2pStatus: row.a2p_status,
    };
  } catch (e) {
    const kind = e instanceof Error ? e.constructor.name : typeof e;
    console.error(`capability facts read failed for account ${accountId}; graded needs_setup: ${kind}`);
    return { read: "failed" };
  }
});
