"use server";

import { revalidatePath } from "next/cache";
import { serviceDb, setChecklistItem, upsertVoiceProfile, setPhoneNumberStatus, renameAccount } from "@bis/db";
import { requireAccountAccess, requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { deriveSetupStatus, goLivePrereqsMet, SETUP_TICK_KEYS } from "@/lib/setup/setup-status";
import { gatherSetupInputs } from "@/lib/setup/setup-inputs";
import { m } from "@/lib/messages";

/** Same shape voice/actions.ts uses, and for the same reason: these run from
 *  client islands that need the failure to arrive as a value they can render,
 *  not a rejected promise. Declared per segment rather than shared — a type
 *  import across two "use server" modules buys nothing and couples them. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The wizard's two manual ticks.
 *
 * Every other step on the setup page is DERIVED from live rows on each
 * render (see lib/setup/setup-status.ts) — deliberately, so a step can never
 * claim to be finished while the thing it describes is not. These two have no
 * derivable source at all: "the client is happy to send from the platform
 * address for now" and "the client's carrier is forwarding their business
 * line to us" are facts about the world outside this database, so they are
 * stored, under the shared `SETUP_TICK_KEYS` catalogue keys the page reads
 * back out of `checklist_items`.
 *
 * Guard: the voice/actions.ts idiom, for the same reason that file spells out
 * — the write below runs on `serviceDb()`, which bypasses RLS, so `isAgency`
 * checked HERE is the only thing standing behind it. It is checked before any
 * db call, which is what actions.test.ts pins (the not-called assertion, not
 * the return value, is the boundary). Result-typed rather than throwing, like
 * every other voice-era action.
 *
 * Two more checks stand between the wire and the write, both load-bearing:
 *
 * `Object.hasOwn(SETUP_TICK_KEYS, tick)` — `tick`'s TYPE is a compile-time
 * `keyof`, but the VALUE crossing a server-action boundary is whatever a
 * browser sends, typed or not. `SETUP_TICK_KEYS["constructor"]` does not
 * throw — it resolves up the prototype chain to `Object`'s constructor
 * function — so without this the call below would run with that as the
 * item key instead of refusing.
 *
 * The try/catch — the goLiveAction idiom in this same file. Uncaught, a
 * failed `setChecklistItem` REJECTS this server action, which the client
 * island's `toast.error(m["setup.tickFailed"])` branch for `{ok:false}` can
 * never see: a rejected server action surfaces as an unhandled error, not
 * the Result this function's own signature promises.
 */
export async function setSetupTickAction(
  accountId: string,
  tick: keyof typeof SETUP_TICK_KEYS,
  done: boolean,
): Promise<{ ok: boolean }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false };

  if (!Object.hasOwn(SETUP_TICK_KEYS, tick)) return { ok: false };

  try {
    await setChecklistItem(serviceDb(), accountId, SETUP_TICK_KEYS[tick], { done }, userId);
  } catch (e) {
    console.error(`setSetupTickAction: write failed for account ${accountId}, tick ${tick}: ${String(e)}`);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Turns the receptionist on: the voice profile is enabled and the account's
 * number goes to `live`, so the next caller reaches an AI instead of a
 * ringtone.
 *
 * THE SERVER-SIDE RE-CHECK IS THE ENFORCEMENT. The panel disables its button
 * until the page's own derivation says the prerequisites are met, but that
 * render is stale the moment it paints — hours can be wiped, a number
 * released, a profile blanked between paint and click — and `disabled` is an
 * attribute anyone can drop. So this action asks the same questions again,
 * against live rows, and refuses on its own evidence. It re-reads rather than
 * accepting anything from the client: nothing about what is ready travels
 * over the wire, only the account id, which the guard above validates.
 *
 * Reads go through `serviceDb()` (passed into `gatherSetupInputs`) to match
 * the writes below. That is a deliberate difference from the PAGE, which
 * reads as the signed-in user so a grants problem shows up as a broken card
 * rather than a page that renders fine for an operator and fails for
 * everyone else. Here the question is not "can this operator see it" — the
 * guard already answered that — but "is it actually true", and a read that
 * RLS silently narrowed would answer that question wrong.
 *
 * `gatherSetupInputs` (lib/setup/setup-inputs.ts) is the one shared copy of
 * this re-check's read set — it reports which of its SIX legs failed rather
 * than an atomic pass/fail (its own doc comment explains why), and is itself
 * per-leg fault-isolated (`Promise.allSettled`), so it should not actually
 * reject; the try/catch below is the same defensive belt-and-braces every
 * other `"use server"` action in this tree wraps its reads in — an
 * exception escaping unhandled would reject this action outright, which the
 * client island's Result-typed rendering can never see (same reasoning
 * `setSetupTickAction`'s own doc comment gives for its write). This action
 * now reads all SIX legs, including `accounts`: branding gates go-live
 * (spec 2026-09-07-brand-name-resolver, `goLivePrereqsMet` in
 * setup-status.ts), and branding is read off the `accounts` row's
 * `brand_name` — the leg this action used to hardcode to `null` and ignore
 * entirely because neither `brandName` nor `fromEmail` used to gate go-live.
 * An `accounts`-leg failure is now exactly as unverifiable as a failed
 * calendar/profile/numbers/calls/ticks read, so it is folded into
 * `reReadFailed` below rather than singled out: a prerequisite this
 * function could not verify is not a met one, and — same distinction the
 * page draws — it must not be reported as an unmet one either, hence the
 * separate `m["setup.goLive.failed"]` rather than `notReady` below.
 */
export async function goLiveAction(accountId: string): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["setup.goLive.denied"] };

  const db = serviceDb();

  let gathered: Awaited<ReturnType<typeof gatherSetupInputs>>;
  try {
    gathered = await gatherSetupInputs(db, accountId);
  } catch (e) {
    console.error(`goLiveAction: prerequisite re-check failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["setup.goLive.failed"] };
  }
  const { inputs, numbers, failed } = gathered;

  const reReadFailed = failed.account || failed.calendar || failed.profile || failed.numbers
    || failed.calls || failed.ticks;
  if (reReadFailed) {
    console.error(`goLiveAction: prerequisite re-check failed for account ${accountId}: ${JSON.stringify(failed)}`);
    return { ok: false, error: m["setup.goLive.failed"] };
  }

  const steps = deriveSetupStatus(inputs);
  if (!goLivePrereqsMet(steps)) return { ok: false, error: m["setup.goLive.notReady"] };

  // A released number is a former number. `deriveSetupStatus`'s number step
  // already excludes them, so this is belt-and-braces — but it is what picks
  // WHICH row goes live, so it has to agree with that check rather than take
  // whatever sorted first.
  const target = numbers.find((n) => n.status !== "released");
  if (!target) return { ok: false, error: m["setup.goLive.notReady"] };

  try {
    // Profile first. This order is still the safer one: the REVERSE would
    // put a live number in front of a disabled profile, meaning a real
    // caller reaches a receptionist that has been told to stay quiet — a
    // gap this order cannot produce, because the profile is already enabled
    // before the number write is even attempted.
    //
    // What this order does NOT guarantee is "a failure here leaves the line
    // not live". The incoming route answers a number at status `testing` OR
    // `live` once the profile is enabled (api/voice/incoming/route.ts), and
    // `target` reaching go-live at `testing` is the ordinary case — the
    // test-call prerequisite needs a reachable number before this action is
    // even unblocked. So if `upsertVoiceProfile` above succeeds and this
    // second write then fails, a `target` that was already `testing` is left
    // fully answering real callers with the profile enabled, while this
    // action reports `ok: false` and the go-live step still reads "to do".
    // Only a `target` starting at `provisioned` genuinely stays unreached
    // through that same failure. Both are real outcomes of the same catch
    // block; naming only the safe one here would be wrong.
    await upsertVoiceProfile(db, accountId, { enabled: true }, userId);
    await setPhoneNumberStatus(db, accountId, target.id, "live", userId);
  } catch (e) {
    console.error(`goLiveAction: go-live write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["setup.goLive.failed"] };
  }

  // No revalidatePath: the setup page is `force-dynamic`, and the client
  // island calls router.refresh() to re-derive all nine cards — same
  // arrangement as setSetupTickAction above.
  return { ok: true };
}

/**
 * Rename the account's INTERNAL label (`accounts.name`) — the agency's own
 * note about this client, e.g. "Rio Roofing — trial". Not the client's
 * public-facing name: branding owns that, and those customer-facing surfaces
 * read through `brandDisplayName(branding)` (lib/email/templates/shell.ts),
 * which takes the branding and NOTHING ELSE — there is no parameter left for
 * this label to travel through. A freshly created account DOES have a
 * `brand_name` — `createAccount` seeds it from the name given at creation,
 * and Branding's own save refuses to ever blank it again (spec
 * 2026-09-07-brand-name-resolver) — so `account.name` is not a customer-facing
 * fallback at all any more. `m["setup.rename.help"]`
 * still spells this relationship out for the agency user renaming the
 * account, since the seeded brand name usually STARTS as a copy of this very
 * label and can drift from it the moment either one is edited alone.
 *
 * Empty is REJECTED rather than allowed to clear, unlike an inline contact
 * field: an account with no name breaks the client switcher, the dashboard
 * greeting and the accounts list, none of which have a fallback for "".
 *
 * The write goes through `renameAccount` (packages/db/src/accounts.ts) rather
 * than a raw `.update()` from this route, which is what every other
 * account-level write in this codebase already does. Two things came with the
 * move, both of which the raw write got wrong: the helper `.select("id")`s so
 * a zero-row update is a FAILURE rather than a silent "saved" toast over
 * nothing, and it emits `account.renamed` with the actor — `accounts` has no
 * `updated_at`, so without that event a rename left no trace anywhere. The
 * `userId` the guard already returns is what carries the actor; it used to be
 * discarded.
 *
 * `accounts` has no `updated_at` column (packages/db/supabase/migrations/
 * 0001_tenancy.sql — only `created_at`), so the write does not try to set one.
 *
 * serviceDb(), not dbForRequest() — deliberately, and NOT the settings/
 * actions.ts pattern of "column has no grant, so escalate": migration 0013
 * (client-branding-grants.test.ts pins this exactly) revokes UPDATE on ALL of
 * `accounts` from `authenticated` and re-grants it column-by-column for the
 * seven branding columns only. `name` was never re-granted — a write through
 * dbForRequest() (the `authenticated` role) fails with "permission denied for
 * column \"name\"" on every real call, a failure only the e2e suite in Task 5
 * can see, because unit tests mock the db client. serviceDb() is the
 * sanctioned route for an agency write to a column `authenticated` cannot
 * touch (0013's own comment: "Safe for the agency: ... run as service_role,
 * which is subject to neither column grants nor RLS"), and it is safe here
 * for the same reason it is safe in setFromEmailAction: the guard below is
 * agency-only and runs BEFORE this line, so it — not any grant — is the only
 * thing standing behind this write. Do not revert this to dbForRequest();
 * that reintroduces the exact permission-denied failure this fix closes.
 */
export async function renameAccountAction(
  accountId: string, value: string,
): Promise<ActionResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const name = value.trim();
  if (!name) return { ok: false, error: m["setup.rename.empty"] };
  try {
    await renameAccount(serviceDb(), accountId, name, userId);
  } catch (e) {
    console.error(`renameAccountAction: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["setup.rename.failed"] };
  }
  revalidatePath(`/dashboard/accounts/${accountId}/setup`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
  revalidatePath("/dashboard/accounts");
  return { ok: true };
}
