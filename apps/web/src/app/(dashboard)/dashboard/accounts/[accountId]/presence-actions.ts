"use server";

import { serviceDb, getVoiceProfile } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { getVoicePresence, type VoicePresence } from "@/lib/voice/presence";

/**
 * The topbar's Sofía presence indicator (topbar-presence.tsx, "use client")
 * calls this directly from a useEffect keyed on the active account id — the
 * same imperative Server Action shape unread-actions.ts's getUnreadTotal and
 * setup-actions.ts's getSetupProgress use, and for the identical reason:
 * dashboard/layout.tsx (where Topbar is actually rendered) sits ABOVE this
 * [accountId] segment and never receives accountId through its own `params`,
 * so the account-scoped read has to happen from inside this segment, not
 * from the layout that draws the topbar. See Task 5's CORRECTED brief for
 * the full ancestor-params trap this sidesteps (third instance of it in this
 * tree).
 *
 * requireAccountAccess, not requireAgencyOnlyAccountAccess: presence is a
 * both-audience indicator (DESIGN.md's "AI presence" pattern names no
 * audience restriction, and a client watching their own receptionist's
 * status is exactly as legitimate as the agency watching it for them) — same
 * choice getUnreadTotal made for the same reason.
 *
 * Returns `null`, not a `{ onCall: false, weekCount: 0 }` idle snapshot,
 * when the account has no ENABLED voice profile — checked FIRST, before
 * either calls query runs, per the brief's explicit "skip the query"
 * semantics moving server-side into this action. `null` is also what a
 * guard failure (caught below) and an off-account render both collapse to
 * on the client side, so the component has exactly one "render nothing"
 * case to handle, not three.
 *
 * `profile.enabled`, not `booking_enabled` or a phone number's `status`:
 * the simplest honest reading of "the account HAS an enabled voice
 * profile" is the profile's own flag. Note this is deliberately NARROWER
 * than accept-gate.ts's `callAnswerable`, which also answers calls for a
 * `testing`-status number regardless of `profile.enabled` — so an account
 * mid-setup (profile disabled, testing number taking real test calls)
 * shows no presence indicator at all, nonzero weekCount included. That is
 * the contract here: presence reflects the profile switch, not "would a
 * call be answered right now".
 *
 * serviceDb(), not dbForRequest(): mirrors getUnreadTotal/getSetupProgress's
 * own choice — a read behind requireAccountAccess, not a write behind a
 * grant boundary.
 *
 * Failure (either query, or the enabled-profile lookup itself) folds to
 * `null` with console.error, same as every sibling action here — presence
 * must never take the topbar down. requireAccountAccess stays OUTSIDE the
 * try: it can redirect() on an unauthorized or stale account id, and
 * catching that here would swallow the throw redirect() uses and silently
 * strand the caller instead of sending them where every other guarded
 * surface in this tree already would.
 */
export async function getVoicePresenceSnapshot(accountId: string): Promise<VoicePresence | null> {
  await requireAccountAccess(accountId);
  try {
    const db = serviceDb();
    const profile = await getVoiceProfile(db, accountId);
    if (!profile || !profile.enabled) return null;
    return await getVoicePresence(db, accountId, new Date());
  } catch (error) {
    console.error(
      `getVoicePresenceSnapshot failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
