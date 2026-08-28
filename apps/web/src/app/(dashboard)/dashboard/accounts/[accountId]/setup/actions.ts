"use server";

import { serviceDb, setChecklistItem } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { SETUP_TICK_KEYS } from "@/lib/setup/setup-status";

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
