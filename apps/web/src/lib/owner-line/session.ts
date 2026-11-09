// apps/web/src/lib/owner-line/session.ts
import { serviceDb, ownerLineSessionCheck, type AccountRole } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";

/** Who an owner-line call is, as the SIP webhook verified it (Task 12's decideOwnerSession builds it). */
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
  if (!r.ok) console.log(`[voice/owner-line] session no longer valid (${r.reason}), accountId ${s.accountId}`);
  return r.ok;
}
