"use server";

/**
 * Writes from the agency numbers inventory (/dashboard/numbers).
 *
 * These are the WIDEST writes in the app. Every other `phone_numbers` write
 * is bound to one account server-side — the setup wizard's `moveNumberAction`
 * takes the destination from a bound argument precisely so "a caller can
 * choose which number to take, never which account to give it to". This
 * screen exists to let the agency choose both, which removes that structural
 * guard, so the guard has to come from the caller's role instead:
 * `requireAgency()` is the first line of both actions, before any read.
 *
 * `requireAgency` REDIRECTS rather than returning a flag (unlike
 * `requireAccountAccess`'s `isAgency`), which is the right shape here: there
 * is no account in scope to soften the answer with. A client reaching these
 * functions is not a permissions edge case, it is someone who should not be
 * on this page at all.
 *
 * Writes go through `serviceDb()` for the same reason the Voice page's do:
 * 0019 grants `authenticated` SELECT on `phone_numbers` and nothing more, so
 * an RLS-scoped write here would fail for every caller, agency included,
 * while every suite that mocks the db layer stayed green.
 */

import {
  serviceDb, getPhoneNumberById, listAccounts, listPhoneNumbersForAccount,
  reassignPhoneNumber, setPhoneNumberStatus, setPhoneNumberTelnyxId,
} from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { canRepairRouting, indexByE164, routingStatus } from "@/lib/voice/number-routing";
import { listTelnyxNumbers, setTelnyxVoiceConnection, telnyxRoutingConfig } from "@/lib/voice/telnyx-numbers";
import { m } from "@/lib/messages";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Moves a number onto another company.
 *
 * Both ids come from the browser, so both are re-established server-side:
 * the number is READ (not trusted) to find out whose it currently is, and
 * the destination's own numbers are read to enforce the occupancy
 * invariant. `buildNumberInventory` already withholds an occupied company
 * from the picker — that render is exactly as stale as the operator's
 * second tab, so the check that matters is this one.
 *
 * The occupancy rule itself is not cosmetic: two active numbers on one
 * account is not a state `deriveSetupStatus` (lib/setup/setup-status.ts) has
 * a step for, so an account in it stops being describable by the wizard at
 * all.
 *
 * No `revalidatePath`: this page and both accounts' Voice pages are all
 * `force-dynamic`, so there is no cached render either side to invalidate —
 * the island calls `router.refresh()` and gets a fresh read.
 */
export async function moveNumberToAccountAction(
  phoneNumberId: string, toAccountId: string,
): Promise<ActionResult> {
  const { userId } = await requireAgency();
  if (!phoneNumberId.trim() || !toAccountId.trim()) {
    return { ok: false, error: m["numbers.notFound"] };
  }

  const db = serviceDb();

  let current;
  try {
    current = await getPhoneNumberById(db, phoneNumberId);
  } catch (e) {
    console.error(`moveNumberToAccountAction: read failed for ${phoneNumberId}: ${String(e)}`);
    return { ok: false, error: m["voice.moveFailed"] };
  }
  if (!current) return { ok: false, error: m["numbers.notFound"] };
  // A move to where it already is would emit a released/assigned pair on the
  // same account's timeline and reset a live number to `provisioned` — a
  // no-op that costs the client their answering line.
  if (current.account_id === toAccountId) {
    return { ok: false, error: m["numbers.sameAccount"] };
  }

  try {
    // The destination has to actually exist and actually be open for
    // business. `buildNumberInventory` already withholds an archived company
    // from the picker; this is the same rule re-established from the
    // database, because that render is exactly as stale as the operator's
    // second tab. The FK on `phone_numbers.account_id` would catch a bogus
    // id on its own — as a 500, not as a sentence anyone can act on.
    const accounts = await listAccounts(db);
    const destinationAccount = (accounts ?? []).find((a) => a.id === toAccountId);
    if (!destinationAccount) return { ok: false, error: m["numbers.destinationMissing"] };
    if (destinationAccount.status === "archived") {
      return { ok: false, error: m["numbers.destinationArchived"] };
    }

    const destination = await listPhoneNumbersForAccount(db, toAccountId);
    // A released number is a FORMER number and does not occupy the slot —
    // the same rule the setup wizard's move applies, and the one that makes
    // a churned client's account reusable.
    if (destination.some((n) => n.status !== "released")) {
      return { ok: false, error: m["voice.moveDestinationOccupied"] };
    }
  } catch (e) {
    console.error(`moveNumberToAccountAction: destination check failed for ${toAccountId}: ${String(e)}`);
    return { ok: false, error: m["voice.moveFailed"] };
  }

  try {
    await reassignPhoneNumber(db, phoneNumberId, toAccountId, userId);
  } catch (e) {
    console.error(`moveNumberToAccountAction: move failed for ${phoneNumberId}: ${String(e)}`);
    return { ok: false, error: m["voice.moveFailed"] };
  }
  return { ok: true };
}

/**
 * Stops a number answering, leaving it where it is.
 *
 * The churn write. A departing client's number keeps costing line rental at
 * the carrier and is still the number their old customers dial, so it is not
 * deleted — but it must stop answering as that client, and it must stop
 * occupying their account's one active-number slot so the account can take a
 * new number later (or the released one can be moved on to somebody else).
 *
 * The account is read from the ROW, never accepted from the caller:
 * `setPhoneNumberStatus` scopes its UPDATE by `account_id` as well as id, and
 * handing it a browser-supplied account would turn a scoped write into a
 * silent no-op against the wrong tenant.
 */
export async function releaseNumberAction(phoneNumberId: string): Promise<ActionResult> {
  const { userId } = await requireAgency();
  if (!phoneNumberId.trim()) return { ok: false, error: m["numbers.notFound"] };

  const db = serviceDb();

  let current;
  try {
    current = await getPhoneNumberById(db, phoneNumberId);
  } catch (e) {
    console.error(`releaseNumberAction: read failed for ${phoneNumberId}: ${String(e)}`);
    return { ok: false, error: m["numbers.releaseFailed"] };
  }
  if (!current) return { ok: false, error: m["numbers.notFound"] };
  // Not an error worth a stack trace, but not a success either: the operator
  // pressed a button whose effect had already happened, and silently toasting
  // "done" would teach them the button does nothing.
  if (current.status === "released") {
    return { ok: false, error: m["numbers.alreadyReleased"] };
  }

  try {
    await setPhoneNumberStatus(db, current.account_id, phoneNumberId, "released", userId);
  } catch (e) {
    console.error(`releaseNumberAction: release failed for ${phoneNumberId}: ${String(e)}`);
    return { ok: false, error: m["numbers.releaseFailed"] };
  }
  return { ok: true };
}

/**
 * Points one number's voice routing at this platform, at the carrier.
 *
 * The first write in this app that reaches past the database and changes
 * something at the phone company. Three things keep that safe:
 *
 *   1. `requireAgency()` first, as with every action in this file.
 *   2. The CONNECTION ID IS NEVER SUPPLIED BY THE CALLER. It comes from
 *      `TELNYX_VOICE_CONNECTION_ID`, and the only phone number that can be
 *      touched is one this platform already has a row for. A caller chooses
 *      which of our numbers to repair, never what to point it at — the same
 *      shape as `moveNumberAction`'s bound destination, for the same reason.
 *      Without it, a web form would be a way to route any number on the
 *      Telnyx account anywhere.
 *   3. The verdict is re-derived from Telnyx HERE, not taken from the page.
 *      `canRepairRouting` refuses a number that is already correct, one the
 *      carrier does not have, and — the dangerous case — one we could not
 *      inspect. Writing a carrier setting on a line we never managed to read
 *      is how a working phone gets broken by a diagnostic.
 *
 * Recording `telnyx_id` afterwards is deliberately NOT allowed to fail the
 * action. By then the phone line is genuinely fixed, which is the whole
 * user-visible outcome, and the id is a record rather than a dependency —
 * every check matches on E.164 against Telnyx's own listing, so the next read
 * re-derives it regardless. Reporting a failure over a bookkeeping miss would
 * send an operator to re-fix a number that is already right.
 */
export async function repairNumberRoutingAction(phoneNumberId: string): Promise<ActionResult> {
  const { userId } = await requireAgency();
  if (!phoneNumberId.trim()) return { ok: false, error: m["numbers.notFound"] };

  const { apiKey, connectionId } = telnyxRoutingConfig();
  if (!apiKey || !connectionId) return { ok: false, error: m["numbers.routing.notConfigured"] };

  const db = serviceDb();

  let current;
  try {
    current = await getPhoneNumberById(db, phoneNumberId);
  } catch (e) {
    console.error(`repairNumberRoutingAction: read failed for ${phoneNumberId}: ${String(e)}`);
    return { ok: false, error: m["numbers.routing.repairFailed"] };
  }
  if (!current) return { ok: false, error: m["numbers.notFound"] };

  let found;
  try {
    found = indexByE164(await listTelnyxNumbers(apiKey)).get(current.e164) ?? null;
  } catch (e) {
    // A carrier that will not answer is NOT a verdict about the number. Say
    // we could not check, and write nothing.
    console.error(`repairNumberRoutingAction: carrier lookup failed for ${current.e164}: ${String(e)}`);
    return { ok: false, error: m["numbers.routing.checkFailed"] };
  }

  const status = routingStatus(found, connectionId);
  if (!canRepairRouting(status)) {
    return {
      ok: false,
      error: status === "routed"
        ? m["numbers.routing.alreadyRouted"]
        : m["numbers.routing.notAtCarrier"],
    };
  }

  try {
    await setTelnyxVoiceConnection(apiKey, found!.id, connectionId);
  } catch (e) {
    console.error(`repairNumberRoutingAction: carrier write failed for ${current.e164}: ${String(e)}`);
    return { ok: false, error: m["numbers.routing.repairFailed"] };
  }

  try {
    await setPhoneNumberTelnyxId(db, current.account_id, phoneNumberId, found!.id, userId);
  } catch (e) {
    // See the header: the line is already fixed. Log it and report success,
    // because success is what actually happened.
    console.error(`repairNumberRoutingAction: telnyx_id not recorded for ${current.e164}: ${String(e)}`);
  }
  return { ok: true };
}
