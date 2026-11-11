// apps/web/src/lib/owner-line/session.ts
import { serviceDb, ownerLineSessionCheck, OWNER_LINE_MAX_CALLS_PER_DAY, type AccountRole, type SupabaseClient } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { verifyOwnerPass, type SipHandoffCheck } from "@/lib/voice/sip-handoff-signature";
import { OWNER_LINE_ROLES } from "./data-path";
import { firstName } from "./names";

/**
 * Who an owner-line call is, as the SIP webhook verified it. `decideOwnerSession` below is meant to be the ONLY place
 * one is built (Task 10/11 review m-3). What the scan in session.test.ts actually catches, in a non-test source: a
 * `: OwnerLineSession =` annotation, `as OwnerLineSession`, `satisfies OwnerLineSession`, and a declared return type
 * of `OwnerLineSession` or `Promise<OwnerLineSession>`. It does NOT catch an `OwnerSessionDecision` literal, a
 * generic `mk<OwnerLineSession>(…)`, an `OwnerToolContext` with an inline session, or `OwnerLineSession | null`
 * (Task 12 review M-2). The type is not branded yet: branding it is a recorded condition on the T flip (plan Task 12
 * as built), when a session's Clerk ids start choosing whose RLS scope a read gets.
 */
export type OwnerLineSession = {
  accountId: string; userId: string; role: AccountRole; clerkUserId: string; clerkOrgId: string;
  firstName: string | null; actorName: string | null; locale: Locale; timezone: string;
};

/**
 * F-032 §5 (plan SC-12): before EVERY tool call, the conditions that made the pass valid are read again: still a
 * member, the same role, the switch on, enrolled and not locked. No daily-limit check here: this call is already
 * counted. False on any refusal; a throw is the caller's to turn into "I couldn't read that".
 */
export async function recheckOwnerSession(s: OwnerLineSession, _now: Date): Promise<boolean> {
  const r = await ownerLineSessionCheck(serviceDb(), {
    accountId: s.accountId, userId: s.userId, role: s.role, maxCalls: null,
  });
  if (!r.ok) {
    console.log(`[voice/owner-line] session no longer valid (${r.reason}), accountId ${s.accountId}`);
    return false;
  }
  // Task 10/11 review m-3: the session must BE the person just re-checked. Under the token path the read token is
  // minted from session.clerkUserId/clerkOrgId (reader.ts), so a session carrying anyone else's Clerk ids would read
  // with THEIR scope. Both ids come back from the same row the check read; any mismatch is a refusal.
  if (r.clerkUserId !== s.clerkUserId || r.clerkOrgId !== s.clerkOrgId) {
    console.log(`[voice/owner-line] session is not the person re-checked (identity mismatch), accountId ${s.accountId}`);
    return false;
  }
  return true;
}

export type OwnerSessionDecision = { ok: true; session: OwnerLineSession } | { ok: false; reason: string };

/**
 * F-032 §4.3 (plan Task 12): an owner-line session ONLY when, in this order,
 *   1. the pass verifies against THIS call's handoff token and is fresh (60 s, at redemption only: SC-12);
 *   2. the call itself came through our answer route (the INVITE's own X-BIS-Signature verified);
 *   3. the pass names the business and the called number that signed statement names (the account resolved off it);
 *   4. its role is one this data path offers (OWNER_LINE_ROLES; F2: Owner and Staff);
 *   5. a live re-read finds the person still a member in THAT SAME role (SC-8), enrolled, unlocked, the switch on,
 *      and under today's limit of calls.
 * Any refusal is a reason for the log and the call is the receptionist's. Single use is the webhook's redemption row
 * (calls_handoff_token_unique), never this function's (SC-7). The reason never carries the pass.
 */
export async function decideOwnerSession(
  p: { db: SupabaseClient; raw: string; handoffToken: string | null; handoffCheck: SipHandoffCheck; accountId: string; now: Date },
  deps: { check: typeof ownerLineSessionCheck } = { check: ownerLineSessionCheck },
): Promise<OwnerSessionDecision> {
  const pass = verifyOwnerPass(p.raw, p.handoffToken, p.now.getTime());
  if (!pass.ok) return { ok: false, reason: `pass-${pass.reason}` };
  if (!p.handoffCheck.ok) return { ok: false, reason: "call-not-signed" };
  if (pass.calledE164 !== p.handoffCheck.calledE164 || pass.accountId !== p.accountId) return { ok: false, reason: "wrong-business" };
  if (!OWNER_LINE_ROLES.includes(pass.role)) return { ok: false, reason: "role-not-offered" };
  const live = await deps.check(p.db, {
    accountId: p.accountId, userId: pass.userId, role: pass.role, maxCalls: OWNER_LINE_MAX_CALLS_PER_DAY,
  });
  if (!live.ok) return { ok: false, reason: live.reason };
  return { ok: true, session: {
    accountId: p.accountId, userId: pass.userId, role: pass.role, clerkUserId: live.clerkUserId, clerkOrgId: live.clerkOrgId,
    firstName: firstName(live.name), actorName: live.name, locale: live.language ?? live.accountLanguage ?? "en",
    timezone: live.timezone,
  } };
}
