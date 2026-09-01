"use server";

import {
  serviceDb, getCalendarForAccount, getVoiceProfile,
  listPhoneNumbersForAccount, countCallsSince, listChecklistState,
} from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { deriveSetupStatus, reduceSetupProgress, SETUP_TICK_KEYS } from "@/lib/setup/setup-status";

export type SetupProgress = { done: number; total: number };

/**
 * The sidebar's setup meter (app-sidebar.tsx, "use client") calls this
 * directly from a useEffect keyed on the active account id — the same
 * imperative Server Action shape getUnreadTotal (./unread-actions.ts) uses,
 * and for the same reason: dashboard/layout.tsx sits ABOVE this [accountId]
 * segment and never receives accountId through its own `params`, so the
 * account-scoped read has to happen from inside this segment, not the
 * layout that draws the sidebar.
 *
 * requireAgencyOnlyAccountAccess, not requireAccountAccess: unlike
 * Conversations' unread count (both-audience), the setup wizard is
 * agency-only work about a client — see setup/page.tsx, gated the same way.
 * app-sidebar.tsx never calls this for a client (its effect early-returns on
 * `!isAgency`), so in practice this guard should never redirect from here —
 * it exists as the same defense-in-depth every other guarded surface in this
 * tree carries: hiding the meter is not authorization.
 *
 * serviceDb(), not dbForRequest(): mirrors getUnreadTotal's own choice, for
 * the same reason — this is a read behind a guard, not a write behind a
 * grant boundary, and requireAgencyOnlyAccountAccess above is what stands
 * behind it. Contrast setup/page.tsx, which deliberately reads as the
 * signed-in user so a grants problem shows up as a broken card on that
 * page's full nine-step render — this is a background sidebar badge, not
 * that page, and it degrades the way a badge always does here: hidden, never
 * broken.
 *
 * Calls deriveSetupStatus (lib/setup/setup-status.ts) directly rather than
 * re-deriving step completion here — the one piece of logic this action must
 * never duplicate. The reads that build its SetupInputs mirror setup/page.tsx
 * and setup/actions.ts's goLiveAction (both already duplicate this same
 * shape for their own reasons), so this is a proven-safe read set, not a new
 * one — unlike goLiveAction, brandName/fromEmail are read for real here
 * rather than hardcoded null, because unlike a go-live prerequisite check,
 * the meter's own count needs the branding and email steps to be right.
 *
 * A failed read folds to `{ done: 0, total: 0 }` rather than throwing or
 * reporting a partial count: `total` here is otherwise always 9, so 0 of 0
 * can only mean "the read failed" — and it satisfies the sidebar's own
 * "done === total ⇒ hidden" rule for free, hiding the meter exactly like a
 * genuinely complete setup does, with no second flag to keep in sync.
 * console.error keeps the failure visible in logs, same as getUnreadTotal.
 */
export async function getSetupProgress(accountId: string): Promise<SetupProgress> {
  await requireAgencyOnlyAccountAccess(accountId);
  const db = serviceDb();
  try {
    const [account, calendar, profile, numbers, callCount, ticks] = await Promise.all([
      db.from("accounts").select("brand_name, from_email").eq("id", accountId).maybeSingle()
        .then(({ data, error }) => {
          if (error) throw new Error(`account lookup failed: ${error.message}`);
          return data as { brand_name: string | null; from_email: string | null } | null;
        }),
      getCalendarForAccount(db, accountId),
      getVoiceProfile(db, accountId),
      listPhoneNumbersForAccount(db, accountId),
      // Epoch floor: "has this account EVER taken a call" — the same
      // question the test-call step asks on the setup page itself.
      countCallsSince(db, accountId, "1970-01-01T00:00:00.000Z"),
      listChecklistState(db, accountId),
    ]);

    const ticked = (key: string) =>
      ticks.some((row) => row.item_key === key && row.done_at !== null);

    const steps = deriveSetupStatus({
      brandName: account?.brand_name ?? null,
      fromEmail: account?.from_email ?? null,
      calendar,
      profile,
      numbers,
      callCount,
      ticks: {
        emailSkipped: ticked(SETUP_TICK_KEYS.emailSkipped),
        forwardingDone: ticked(SETUP_TICK_KEYS.forwardingDone),
      },
    });

    return reduceSetupProgress(steps);
  } catch (error) {
    console.error(
      `getSetupProgress failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { done: 0, total: 0 };
  }
}
