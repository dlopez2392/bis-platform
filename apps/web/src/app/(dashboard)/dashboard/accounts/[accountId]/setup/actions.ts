"use server";

import {
  serviceDb, setChecklistItem, getCalendarForAccount, getVoiceProfile,
  listPhoneNumbersForAccount, countCallsSince, listChecklistState,
  upsertVoiceProfile, setPhoneNumberStatus,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { deriveSetupStatus, goLivePrereqsMet, SETUP_TICK_KEYS } from "@/lib/setup/setup-status";
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
 */
export async function setSetupTickAction(
  accountId: string,
  tick: keyof typeof SETUP_TICK_KEYS,
  done: boolean,
): Promise<{ ok: boolean }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false };

  await setChecklistItem(serviceDb(), accountId, SETUP_TICK_KEYS[tick], { done }, userId);
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
 * Reads go through `serviceDb()` to match the writes below. That is a
 * deliberate difference from the PAGE, which reads as the signed-in user so
 * a grants problem shows up as a broken card rather than a page that renders
 * fine for an operator and fails for everyone else. Here the question is not
 * "can this operator see it" — the guard already answered that — but "is it
 * actually true", and a read that RLS silently narrowed would answer that
 * question wrong.
 */
export async function goLiveAction(accountId: string): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["setup.goLive.denied"] };

  const db = serviceDb();

  // `Promise.all`, not `allSettled` as the page uses: the page degrades a
  // failed read to "couldn't check" and keeps rendering, but there is no
  // degraded version of this decision. A prerequisite we could not verify is
  // not a met one, and it must not be reported as an unmet one either — hence
  // the distinct `failed` copy rather than `notReady`.
  let steps;
  let numbers;
  try {
    const [calendar, profile, rows, callCount, ticks] = await Promise.all([
      getCalendarForAccount(db, accountId),
      getVoiceProfile(db, accountId),
      listPhoneNumbersForAccount(db, accountId),
      // Epoch floor: "has this account EVER taken a call", which is what the
      // test-call prerequisite asks — same question the page asks.
      countCallsSince(db, accountId, "1970-01-01T00:00:00.000Z"),
      listChecklistState(db, accountId),
    ]);
    numbers = rows;
    // brandName/fromEmail decide the branding and email steps, and neither
    // gates go-live (see goLivePrereqsMet) — so nulls here rather than a
    // sixth read whose answer this function would then ignore.
    //
    // The checklist read above is the deliberate exception to that: today's
    // prereq set ignores the two ticks as well, so by the same argument it
    // could be dropped for a hardcoded pair of `false`s. It is not, because
    // the two failure modes are not the same size. A transient checklist
    // failure costs one honest "try again" and a reload. Hardcoding `false`
    // costs nothing until someone adds `forwarding` to goLivePrereqsMet — and
    // then go-live becomes permanently impossible for every account, while
    // the panel insists the operator finish a step whose tick is already set.
    // A read that is redundant now is cheaper than that.
    steps = deriveSetupStatus({
      brandName: null,
      fromEmail: null,
      calendar,
      profile,
      numbers: rows,
      callCount,
      ticks: {
        emailSkipped: ticks.some(
          (t) => t.item_key === SETUP_TICK_KEYS.emailSkipped && t.done_at !== null,
        ),
        forwardingDone: ticks.some(
          (t) => t.item_key === SETUP_TICK_KEYS.forwardingDone && t.done_at !== null,
        ),
      },
    });
  } catch (e) {
    console.error(`goLiveAction: prerequisite re-check failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["setup.goLive.failed"] };
  }

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
