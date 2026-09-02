// apps/web/src/lib/setup/setup-inputs.ts
import {
  getCalendarForAccount, getVoiceProfile, listPhoneNumbersForAccount,
  countCallsSince, listChecklistState, type SupabaseClient,
} from "@bis/db";
import { SETUP_TICK_KEYS, type SetupInputs } from "./setup-status";

/**
 * The six reads `deriveSetupStatus` needs to answer all nine step
 * questions — the account's own `brand_name`/`from_email` plus five
 * `@bis/db` reads. This exact read set used to live duplicated three times:
 * the sidebar's setup meter (formerly `setup-actions.ts`'s `getSetupProgress`,
 * now folded into `shell-actions.ts`'s `getShellSnapshot`), the setup
 * wizard's own render (`setup/page.tsx`), and `goLiveAction`'s prerequisite
 * re-check (`setup/actions.ts`). One copy here now.
 *
 * Promise.all, not allSettled: a leg failing rejects the WHOLE call. A
 * partial answer here would be a partial derivation of setup status, and
 * none of the three callers wants that — each decides its own shape around
 * this single atomic promise instead: `getShellSnapshot` folds the whole
 * setup section to `null` on any failure; `goLiveAction` reports "couldn't
 * verify" rather than risking a false "not ready"; `setup/page.tsx` marks
 * every step "couldn't check" together rather than trusting a step it could
 * not actually verify. Tolerates a missing account row (`maybeSingle()`
 * returns `null`) rather than throwing "not found" — this mirrors the
 * sidebar meter's original behavior, not the wizard page's own (which
 * separately confirms the account exists for its header display; see that
 * file for why it keeps a second, tiny `name`-only query alongside this
 * call rather than folding that into `SetupInputs`, which has no `name`
 * field — it exists to feed `deriveSetupStatus`, not to paint a header).
 *
 * `numbers`'s declared type here is the narrower `Pick<PhoneNumberRow,
 * "status">[]` `SetupInputs` already carried (deriveSetupStatus only ever
 * asks about status) — but the array itself is the SAME full rows
 * `listPhoneNumbersForAccount` returns, not a stripped-down copy. A caller
 * that needs `id`/`e164` too (goLiveAction picking which number to flip
 * live; setup/page.tsx's own assignedNumber/movableNumbers) casts back to
 * the wider type rather than triggering a second read of the same table.
 *
 * `db` is passed in, not read from ambient state, so each of the three
 * callers keeps its own already-settled choice of client: the wizard page
 * runs as the signed-in agency user (`dbForRequest()`, so a grants problem
 * shows up as a broken card, unchanged by this move), the sidebar meter and
 * goLiveAction's re-check both already ran on `serviceDb()`.
 */
export async function gatherSetupInputs(
  db: SupabaseClient, accountId: string,
): Promise<SetupInputs> {
  const [account, calendar, profile, numbers, callCount, ticks] = await Promise.all([
    db.from("accounts").select("brand_name, from_email").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`gatherSetupInputs: account lookup failed: ${error.message}`);
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

  return {
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
  };
}
