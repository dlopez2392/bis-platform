"use server";

import { serviceDb, sumUnreadCount, getVoiceProfile } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { gatherSetupInputs } from "@/lib/setup/setup-inputs";
import { deriveSetupStatus, reduceSetupProgress } from "@/lib/setup/setup-status";
import { getVoicePresence, type VoicePresence } from "@/lib/voice/presence";

export type ShellSnapshot = {
  unreadTotal: number;
  setup: { done: number; total: number } | null;
  presence: VoicePresence | null;
};

/**
 * The shell's one background read per in-account navigation — the sidebar's
 * Conversations badge, its footer setup meter, and the topbar's Sofía
 * presence indicator, coalesced from three separate `"use server"` POSTs
 * (`unread-actions.ts`'s `getUnreadTotal`, `setup-actions.ts`'s
 * `getSetupProgress`, `presence-actions.ts`'s `getVoicePresenceSnapshot` —
 * all deleted by this task) into one. Next.js executes same-client server
 * actions SERIALLY, so three background reads used to queue in front of any
 * user mutation fired on the same navigation; one call removes that queue.
 *
 * `ShellDataProvider` (components/shell-data.tsx, "use client") calls this
 * directly from a `useEffect` keyed on the active account id — the same
 * imperative Server Action shape all three deleted actions used, and for the
 * identical reason each of their own doc comments gave: dashboard/layout.tsx
 * (where AppSidebar and Topbar both actually render) sits ABOVE this
 * [accountId] segment and never receives accountId through its own `params`
 * — ancestor layouts only get the params for segments up to and including
 * themselves — so the account-scoped read has to happen from inside this
 * segment, as a client-callable action, not from the layout that draws the
 * shell.
 *
 * `requireAccountAccess`, not `requireAgencyOnlyAccountAccess`: Conversations
 * and presence are both-audience items, same as their own deleted actions
 * always were. Setup is agency-only data about the client, so THIS action
 * derives `isAgency` off the same guard `requireAgencyOnlyAccountAccess`
 * itself builds on (`apps/web/src/lib/auth.ts`) rather than calling that
 * stricter guard directly — calling it here would redirect a client
 * (`requireAgencyOnlyAccountAccess` bounces a non-agency caller to their own
 * dashboard) just for asking a shell-data question that has a perfectly
 * good client-side answer: hide the section. `setup: null` for a client is
 * the server deciding that, never the client — the section is simply never
 * computed for them, not computed and then hidden by the caller.
 *
 * The three reads run concurrently, but each is caught and folded
 * INDEPENDENTLY: one leg's failure degrades only ITS section to the value
 * that was already this shell's own "hidden" convention (`unreadTotal: 0`,
 * `setup: null`, `presence: null`) with its own `console.error`, exactly as
 * each deleted action did on its own. A single shared try/catch around all
 * three would let one flaky read blank sections that answered fine — a
 * badge, a meter, and a presence dot must never take each other down.
 * `requireAccountAccess` stays OUTSIDE every try, same as all three deleted
 * actions: it can `redirect()` on an unauthorized or stale account id, and
 * `redirect()` works by throwing, so catching it here would swallow that
 * throw and silently strand the caller instead of sending them where every
 * other guarded surface in this tree already would.
 *
 * Setup's read chain (`gatherSetupInputs` → `deriveSetupStatus` →
 * `reduceSetupProgress`) is the same proven-safe read set
 * `getSetupProgress` used, now the one shared copy in
 * `lib/setup/setup-inputs.ts` — see that module's own doc comment for why a
 * failure inside it rejects the whole chain rather than answering with a
 * partial read.
 *
 * Presence: `getVoiceProfile` is checked FIRST — `null` when the account has
 * no ENABLED voice profile, before `getVoicePresence`'s two calls ever run —
 * per `getVoicePresenceSnapshot`'s own original "skip the query" semantics.
 * `profile.enabled`, not `booking_enabled` or a phone number's `status`: the
 * simplest honest reading of "the account HAS an enabled voice profile" is
 * the profile's own flag — deliberately narrower than accept-gate.ts's
 * `callAnswerable`, which also answers for a `testing`-status number
 * regardless of `profile.enabled`. This `getVoiceProfile` call is separate
 * from the one `gatherSetupInputs` makes for the setup leg above — sharing
 * one read across both sections would mean a single failed lookup blanks
 * two sections at once (and would run even for a client, for whom the setup
 * leg never executes at all), which is exactly the coupling the per-leg
 * fold above exists to avoid.
 */
export async function getShellSnapshot(accountId: string): Promise<ShellSnapshot> {
  const { isAgency } = await requireAccountAccess(accountId);
  const db = serviceDb();

  const [unreadTotal, setup, presence] = await Promise.all([
    readUnreadTotal(db, accountId),
    readSetupProgress(db, accountId, isAgency),
    readPresence(db, accountId),
  ]);

  return { unreadTotal, setup, presence };
}

async function readUnreadTotal(db: ReturnType<typeof serviceDb>, accountId: string): Promise<number> {
  try {
    return await sumUnreadCount(db, accountId);
  } catch (error) {
    console.error(
      `getShellSnapshot: unread read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

async function readSetupProgress(
  db: ReturnType<typeof serviceDb>, accountId: string, isAgency: boolean,
): Promise<{ done: number; total: number } | null> {
  if (!isAgency) return null;
  try {
    const inputs = await gatherSetupInputs(db, accountId);
    return reduceSetupProgress(deriveSetupStatus(inputs));
  } catch (error) {
    console.error(
      `getShellSnapshot: setup read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function readPresence(
  db: ReturnType<typeof serviceDb>, accountId: string,
): Promise<VoicePresence | null> {
  try {
    const profile = await getVoiceProfile(db, accountId);
    if (!profile || !profile.enabled) return null;
    return await getVoicePresence(db, accountId, new Date());
  } catch (error) {
    console.error(
      `getShellSnapshot: presence read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
