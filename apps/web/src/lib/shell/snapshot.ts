import {
  serviceDb, sumUnreadCount, getVoiceProfile, hasActiveCallSince, readAccountTimezone,
  getBusinessStatusRow, listClosedDaysFrom, readHoursChain, type SupabaseClient, type AccountRole,
} from "@bis/db";
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
 * The shell's one background read per in-account navigation — the sidebar's Conversations badge, its footer
 * setup meter, the topbar's Sofía presence indicator and the business-status switch, in one answer.
 *
 * Served by the plain GET `api/accounts/[accountId]/shell/route.ts`, which `ShellDataProvider`
 * (components/shell-data.tsx) fetches on every in-account navigation. It was a server action
 * (`getShellSnapshot`, shell-actions.ts) until the agency refresh loop of 2026-10-30: Next posts a server
 * action to the router's CURRENT url, and an action's redirect (the reason gate's, from requireAccountAccess)
 * or a response that modifies a cookie navigates or refreshes the WHOLE page. A route handler can do
 * neither, so a background read can never move the person. The route admits the caller
 * (`apiAccountAccessWithRole`: null, never a redirect, for the agency with no live visit) and hands this
 * module the actor it settled; this module reads, and never decides who may.
 *
 * The caller's role shapes the answer. Setup is agency-only data about the client: `setup: null` for a
 * client is the server deciding that, never the browser. A Technician, or a client whose role could not be
 * settled, gets the narrow shell (failing closed, like requireNotTechnician).
 *
 * The four reads run concurrently, but each is caught and folded INDEPENDENTLY: one leg's failure degrades
 * only ITS section to the shell's own "hidden" value (`unreadTotal: 0`, `setup: null`, `presence: null`,
 * `businessStatus: null`) with its own `console.error`. A badge, a meter, and a presence dot must never take
 * each other down.
 *
 * Setup's read chain (`gatherSetupInputs` → `deriveSetupStatus` → `reduceSetupProgress`) is the one shared
 * copy in `lib/setup/setup-inputs.ts`, per-leg fault-isolated internally; this leg folds to `null` the moment
 * one of the SIX `COUNT_DEPENDS_ON` reads failed (not `forms`/`conversations`, which `done` never reads).
 *
 * Presence: `getVoiceProfile` is checked FIRST — `null` when the account has no ENABLED voice profile —
 * and it is this leg's own read, never shared with the setup leg's, so one failed lookup never blanks two
 * sections at once.
 */
export async function readShellSnapshot(
  accountId: string, { isAgency, role }: { isAgency: boolean; role: AccountRole | null },
): Promise<ShellSnapshot> {
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
      `shell snapshot: unread read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
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
      `shell snapshot: setup read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
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
        `shell snapshot: presence zone read failed for account ${accountId}: ${accountError.message}`,
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
      `shell snapshot: presence read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
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
      `shell snapshot: business status read failed for account ${accountId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
