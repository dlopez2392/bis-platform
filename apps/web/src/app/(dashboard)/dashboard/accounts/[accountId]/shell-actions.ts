"use server";

import {
  serviceDb, sumUnreadCount, getVoiceProfile, hasActiveCallSince, readAccountTimezone,
  getBusinessStatusRow, listClosedDaysFrom, readHoursChain, type SupabaseClient, type AccountRole,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { dbForRequest } from "@/lib/db";
import { gatherSetupInputs } from "@/lib/setup/setup-inputs";
import { deriveSetupStatus, reduceSetupProgress } from "@/lib/setup/setup-status";
import type { ReadKey } from "@/lib/setup/setup-view";
import { getVoicePresence, type VoicePresence } from "@/lib/voice/presence";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { canChangeFor, type CanChange } from "@/lib/business-status/guard";
import { addDays, dayKey, effectiveStatus, hoursChain, toWire, type WireStatus } from "@/lib/business-status/status";

/**
 * Exactly the reads `deriveSetupStatus`'s `done` computations touch (fix-round
 * review, IMPORTANT 1) — NOT `Object.values(failed)`'s full set. `forms` and
 * `conversations` (the website-assistant step's own two legs) are deliberately
 * excluded: `deriveSetupStatus` never reads `inputs.publishedFormCount` or
 * `inputs.conciergeSiteConversation` at all (website_assistant's `done` is
 * `profile?.concierge_enabled && concierge_form_id` alone; row 2/row 4 are
 * proof for the PANE, not a `done` input) — same reasoning `actions.ts`
 * already carries for `reReadFailed` excluding the same two keys from
 * go-live's re-check. A hiccup on either must not blank a footer meter
 * DESIGN.md pins as always visible over a count it never touched.
 */
const COUNT_DEPENDS_ON: readonly ReadKey[] = [
  "account", "calendar", "profile", "numbers", "calls", "ticks",
];

export type ShellSnapshot = {
  unreadTotal: number;
  setup: { done: number; total: number } | null;
  // `personaName` (D-063 follow-up): the topbar's own "{name} · on a call"
  // needs the account's configured persona too, carried alongside
  // `VoicePresence` rather than folded into that type — `getVoicePresence`
  // (lib/voice/presence.ts) is about CALL COUNTS, and this read already has
  // the profile in hand from the `profile.enabled` gate just above it.
  //
  // `showCount` (F-085 part 1, spec §7.2): false for a Technician, whose
  // topbar keeps the on-a-call pulse but not the account's week total. Their
  // reply carries no `weekCount` at all (fix round 1, review I1): hiding a
  // number the browser still receives is not refusing it.
  presence: ShellPresence | null;
  // S-47d Task 11 (plan "The shell leg", spec §5.6.1): the one switch's
  // effective state, for the topbar indicator and the dashboard card to
  // agree on without either re-deriving it. A fourth fault-isolated leg
  // (`readBusinessStatus`), null on any read failure, exactly as the other
  // three degrade on their own.
  businessStatus: ShellBusinessStatus | null;
};

export type ShellPresence =
  | (VoicePresence & { personaName: string; showCount: true })
  | { onCall: boolean; personaName: string; showCount: false };

export type ShellBusinessStatus = {
  effective: WireStatus;
  canChange: CanChange;
  timezone: string;
  // SD19: an account with no voice profile still has the switch, so this is
  // never assumed — null when the account has no voice_profiles row at all,
  // set whether or not that profile is ENABLED (readPresence's own
  // `profile.enabled` gate is a separate question: whether the account's AI
  // presence shows, not whether its switch may name a persona in a toast).
  personaName: string | null;
  now: string;
};

/** The same floor getVoicePresence uses for "on a call" (an unfinished row ages out). */
const ON_CALL_FLOOR_MS = 60 * 60 * 1000;

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
 * `lib/setup/setup-inputs.ts`. That function is per-leg fault-isolated
 * internally (see its own doc comment) and reports which of its EIGHT reads
 * failed rather than rejecting outright — this leg folds to `null` the
 * moment one of the SIX `COUNT_DEPENDS_ON` reads did, matching this action's
 * own one-leg-at-a-time contract: a setup count built from a partial read is
 * not a count worth showing. NOT `Object.values(failed).some(Boolean)`
 * (fix-round review, IMPORTANT 1) — that folded in `forms`/`conversations`
 * too, blanking this always-visible footer meter over two reads
 * `deriveSetupStatus` never touches when computing `done`.
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
  // M7a PR-4 (plan G11): reads only, so it stays usable while the account is paused.
  const { isAgency, role } = await requireAccountAccess(accountId, { duringPause: "allow" });
  const db = serviceDb();
  // The narrow shell, failing closed like requireNotTechnician (fix round 1):
  // a Technician, or a client whose role could not be settled (null). Only
  // the agency, an Owner and Staff get the account-wide badge and count.
  const narrow = !seesWholeAccount({ isAgency, role });
  // Spec §7.2: the unread badge counts a Technician's OWN conversations,
  // which only RLS knows. Handed over as a factory so a request client that
  // cannot be built (no token) fails inside that leg's own catch, like any
  // other read, rather than taking the meter and presence down with it.
  const unreadDb = narrow ? dbForRequest : async () => db;

  const [unreadTotal, setup, presence, businessStatus] = await Promise.all([
    readUnreadTotal(unreadDb, accountId),
    readSetupProgress(db, accountId, isAgency),
    readPresence(db, accountId, narrow),
    readBusinessStatus(db, accountId, { isAgency, role }),
  ]);

  return { unreadTotal, setup, presence, businessStatus };
}

async function readUnreadTotal(db: () => Promise<SupabaseClient>, accountId: string): Promise<number> {
  try {
    return await sumUnreadCount(await db(), accountId);
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
    const { inputs, failed } = await gatherSetupInputs(db, accountId);
    if (COUNT_DEPENDS_ON.some((key) => failed[key])) return null;
    return reduceSetupProgress(deriveSetupStatus(inputs));
  } catch (error) {
    console.error(
      `getShellSnapshot: setup read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function readPresence(
  db: ReturnType<typeof serviceDb>, accountId: string, narrow: boolean,
): Promise<ShellPresence | null> {
  try {
    const profile = await getVoiceProfile(db, accountId);
    if (!profile || !profile.enabled) return null;
    // A Technician (spec §7.2, fix round 1 I1): only the on-a-call check
    // runs. The account's weekly answered-calls count is never read for them,
    // so it cannot reach their browser; nor is the zone, which only that
    // count's week boundary needs.
    if (narrow) {
      const since = new Date(Date.now() - ON_CALL_FLOOR_MS).toISOString();
      const onCall = await hasActiveCallSince(db, accountId, since);
      return { onCall, personaName: profile.persona_name, showCount: false };
    }
    // D-075: "this week" is measured in the ACCOUNT's own zone, not UTC —
    // read only now that a presence read is actually going to happen (an
    // account with no enabled voice profile never pays for this query).
    // `resolveAccountZone` falls back to `null` on an unusable value; "UTC"
    // here is the SAME clamp the old UTC-only implementation effectively
    // always used, so a broken zone keeps today's behavior rather than
    // throwing. Not `renderZone`'s heavier agency-zone escalation — that
    // queries a second table for a topbar indicator whose own contract is
    // "degrade to null on any failure", not a KPI screen several numbers
    // must agree with to the hour.
    const { data: account, error: accountError } = await db.from("accounts")
      .select("timezone").eq("id", accountId).maybeSingle();
    // A real query error is NOT "no usable timezone" — `resolveAccountZone`
    // would clamp either one to "UTC" the same way, so the fallback below is
    // right either way, but a DB hiccup silently wearing the same "UTC" as a
    // genuinely blank timezone would hide the former from anyone watching
    // the logs. Degrade (never throw out of this leg; the outer try/catch
    // would blank presence ENTIRELY for a one-column read failing), but say
    // so.
    if (accountError) {
      console.error(
        `getShellSnapshot: presence zone read failed for account ${accountId}: ${accountError.message}`,
      );
    }
    const zone = resolveAccountZone((account as { timezone: string | null } | null)?.timezone) ?? "UTC";
    const presence = await getVoicePresence(db, accountId, new Date(), zone);
    // D-063 follow-up: the topbar's own "{name} · on a call" needs this
    // account's configured persona too — already in hand from the
    // `profile.enabled` gate above, never a second read.
    return { ...presence, personaName: profile.persona_name, showCount: true };
  } catch (error) {
    console.error(
      `getShellSnapshot: presence read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * S-47d Task 11: the shell's fourth leg — today's effective business status, who may change it, and
 * (SD19) this account's persona name, never assumed from the switch alone. `serviceDb()`-sourced `db`,
 * same as `readSetupProgress`/`readPresence` above (the business_status/closed_days tables grant SELECT
 * to `authenticated` too, so this never needed the request client's RLS — it reads the one account this
 * caller already belongs to, the same scope every leg in this file keeps).
 *
 * Its own `getVoiceProfile` call, never `readPresence`'s: a disabled profile still names its persona
 * here (so the switch's toast can say "{persona} says so too.", spec SD19) even though presence itself
 * stays null for it — two different questions, two independent reads, same reasoning this file already
 * gives for not sharing the setup leg's profile read with presence's own.
 *
 * A throw anywhere in this leg (the zone read, any of the three business-status reads, or the pure
 * `effectiveStatus`/`canChangeFor` computation) folds to `null` here and logs, exactly as the other
 * three legs do — never escaping to take the whole snapshot down.
 */
async function readBusinessStatus(
  db: ReturnType<typeof serviceDb>, accountId: string, actor: { isAgency: boolean; role: AccountRole | null },
): Promise<ShellBusinessStatus | null> {
  try {
    const now = new Date();
    const timezone = (await readAccountTimezone(db, accountId)) ?? "UTC";
    const today = dayKey(now, timezone);
    const [row, closedDays, raw, profile] = await Promise.all([
      getBusinessStatusRow(db, accountId),
      listClosedDaysFrom(db, accountId, addDays(today, -1)),
      readHoursChain(db, accountId),
      getVoiceProfile(db, accountId),
    ]);
    const hours = hoursChain(raw.businessHours, raw.calendarHours);
    const effective = effectiveStatus({ row, closedDays, hours, timezone, now });
    const canChange = canChangeFor({ isAgency: actor.isAgency, role: actor.role }, effective);
    return {
      effective: toWire(effective), canChange, timezone,
      personaName: profile?.persona_name ?? null, now: now.toISOString(),
    };
  } catch (error) {
    console.error(
      `getShellSnapshot: business status read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
