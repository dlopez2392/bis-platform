"use server";

/**
 * Agency-only writes to the voice tables (0019_voice_core.sql).
 *
 * The guard rule this file exists to satisfy (recorded from a prior
 * milestone as a Critical, sibling to the `setFromEmailAction`/
 * `setBookingStatusAction` writes in settings/actions.ts and calendar/
 * actions.ts): `phone_numbers` and `voice_profiles` grant `authenticated`
 * SELECT only — see the migration's own header comment. A `dbForRequest()`
 * write here would fail for every caller, agency included, while every
 * suite that mocks the db layer (as this file's own test does) stays green
 * regardless. So every action below: ① authenticates AND verifies the
 * caller is the agency, ② writes through `serviceDb()`, which is the ONLY
 * thing standing behind these writes — nothing in the database is.
 *
 * The guard itself is `requireAccountAccess` — the same function
 * branding/actions.ts calls for its own preamble — plus an explicit
 * `isAgency` check. Branding does not add that check: its own header
 * explains it was deliberately WIDENED to admit the client too. Voice must
 * NOT be widened the same way; the exact mechanism settings/actions.ts uses
 * to keep `setClientAccessAction`/`inviteClientAdminAction` agency-only is
 * this same `isAgency` field, just returned here (Result-typed throughout)
 * rather than thrown.
 */

import { revalidatePath } from "next/cache";
import {
  serviceDb, upsertVoiceProfile, assignPhoneNumber, setPhoneNumberStatus, getVoiceProfile,
  reassignPhoneNumber, listPhoneNumbersForAccount, setTransferPhone,
  type PhoneNumberStatus, type VoiceProfilePatch,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveHandoffTarget } from "@/lib/voice/handoff";
import { m } from "@/lib/messages";

export type ActionResult = { ok: true } | { ok: false; error: string };

const LANGUAGE_VALUES = ["en", "es", "both"] as const;
const AFTER_HOURS_VALUES = ["hours_then_message", "message_only"] as const;
const STATUS_VALUES: readonly PhoneNumberStatus[] = ["provisioned", "testing", "live", "released"];

function pickOne<T extends readonly string[]>(raw: string, allowed: T): T[number] | null {
  return (allowed as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}

export async function saveVoiceProfileAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["voice.agencyOnly"] };

  const languages = pickOne(String(formData.get("languages") ?? "both"), LANGUAGE_VALUES);
  const afterHours = pickOne(String(formData.get("after_hours") ?? "hours_then_message"), AFTER_HOURS_VALUES);
  if (!languages || !afterHours) return { ok: false, error: m["voice.profile.saveFailed"] };

  // The client marks this field `required`, but that is not enforcement — a
  // blank/whitespace submission (bypassed form, stripped JS) must still land
  // on a sane name server-side rather than an empty persona.
  const personaName = String(formData.get("persona_name") ?? "").trim();
  const patch: VoiceProfilePatch = {
    persona_name: personaName || "Sofía",
    greeting_en: String(formData.get("greeting_en") ?? ""),
    greeting_es: String(formData.get("greeting_es") ?? ""),
    facts: String(formData.get("facts") ?? ""),
    services: String(formData.get("services") ?? ""),
    languages,
    booking_enabled: formData.get("booking_enabled") === "on",
    after_hours: afterHours,
    enabled: formData.get("enabled") === "on",
    textback_enabled: formData.get("textback_enabled") === "on",
    textback_body: String(formData.get("textback_body") ?? ""),
  };

  try {
    await upsertVoiceProfile(serviceDb(), accountId, patch, userId);
  } catch (e) {
    console.error(`saveVoiceProfileAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["voice.profile.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/voice`);
  return { ok: true };
}

export async function assignNumberAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["voice.agencyOnly"] };

  const e164 = toE164(String(formData.get("e164") ?? ""));
  if (!e164) return { ok: false, error: m["voice.numbers.badE164"] };

  const telnyxId = String(formData.get("telnyxId") ?? "").trim();

  try {
    await assignPhoneNumber(
      serviceDb(), accountId,
      telnyxId ? { e164, telnyxId } : { e164 },
      userId,
    );
  } catch (e) {
    console.error(`assignNumberAction: assign failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["voice.numbers.assignFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/voice`);
  return { ok: true };
}

/**
 * Moves an existing number onto `accountId` — pressed from the setup
 * wizard's number step, but it lives here because it is a `phone_numbers`
 * write and belongs with the guard and result shape the rest of this file
 * uses.
 *
 * The widest write in the file: `reassignPhoneNumber` takes a row OFF another
 * tenant, and `serviceDb()` bypasses RLS on both sides, so the `isAgency`
 * check is the only thing standing between a client session and another
 * client's phone line. Checked before the db call, which is what the test
 * pins. `accountId` is the DESTINATION and comes from the bound server-side
 * argument, never a form field — a caller can choose which number to take,
 * never which account to give it to.
 *
 * No revalidatePath: unlike the actions above, this one is pressed from the
 * setup page (force-dynamic, refreshed client-side by the island), and the
 * OTHER account's voice page — the one that just lost a number — is
 * force-dynamic too, so there is no cached render either side to invalidate.
 *
 * The destination precondition — "only offer a move when this account has no
 * active number of its own" — is re-checked HERE too, not just where the
 * setup page decides whether to render the move list at all
 * (setup/page.tsx's `assignedNumber === null` gate). That render is exactly
 * as stale as the go-live prerequisites are the moment it paints (see
 * goLiveAction's own header, ../setup/actions.ts): a second browser tab, a
 * number assigned in between, or a bound action called directly can all
 * reach this function with a destination that is no longer empty. Without
 * this read a stale submission would give one account two active numbers —
 * which is not a state `deriveSetupStatus` (setup-status.ts) has a step for.
 */
export async function moveNumberAction(
  accountId: string, phoneNumberId: string,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["voice.agencyOnly"] };

  const db = serviceDb();

  try {
    const destinationNumbers = await listPhoneNumbersForAccount(db, accountId);
    // A released number is a former number — it does not count as "already
    // has one", the same rule the setup page's own read applies.
    if (destinationNumbers.some((n) => n.status !== "released")) {
      return { ok: false, error: m["voice.moveDestinationOccupied"] };
    }
  } catch (e) {
    console.error(`moveNumberAction: destination check failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["voice.moveFailed"] };
  }

  try {
    await reassignPhoneNumber(db, phoneNumberId, accountId, userId);
  } catch (e) {
    console.error(`moveNumberAction: move failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["voice.moveFailed"] };
  }
  return { ok: true };
}

/**
 * `live` additionally requires a voice profile that is not an empty shell:
 * an enabled line that knows nothing to say is a liability, not a feature.
 * Checked here, BEFORE the write, via a fresh read rather than a trusted
 * client-side flag — the go-live gate has to hold even if a caller bypasses
 * the form entirely.
 */
export async function setNumberStatusAction(
  accountId: string, phoneNumberId: string, status: string,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["voice.agencyOnly"] };

  const validStatus = pickOne(status, STATUS_VALUES);
  if (!validStatus) return { ok: false, error: m["voice.numbers.statusUpdateFailed"] };

  if (validStatus === "live") {
    const profile = await getVoiceProfile(serviceDb(), accountId);
    const hasGreeting = Boolean(profile?.greeting_en?.trim() || profile?.greeting_es?.trim());
    const hasFacts = Boolean(profile?.facts?.trim());
    if (!hasGreeting && !hasFacts) {
      return { ok: false, error: m["voice.numbers.goLiveNeedsProfile"] };
    }
  }

  try {
    await setPhoneNumberStatus(serviceDb(), accountId, phoneNumberId, validStatus, userId);
  } catch (e) {
    console.error(`setNumberStatusAction: status update failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["voice.numbers.statusUpdateFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/voice`);
  return { ok: true };
}

/**
 * Sets — or clears — the ONE number a caller who asks for a person is put
 * through to (`accounts.transfer_phone`, 0037_call_handoff.sql). The only
 * write path this column has, and the only way Sofía's "one moment, I'll put
 * you through" ever becomes reachable for an account.
 *
 * Agency-only, and that gate is load-bearing in a way the others in this file
 * are not quite: 0037 deliberately grants `authenticated` NO update on this
 * column, `serviceDb()` bypasses RLS, and whoever writes it decides where
 * this tenant's live callers are connected — on the tenant's own trunk, at
 * the tenant's own per-minute cost. Nothing in the database stands behind
 * this; the `isAgency` check does.
 *
 * Three rules, each with a caller-visible failure behind it:
 *
 * ① BLANK CLEARS IT, as NULL — never `""`. The column's CHECK refuses the
 *    empty string precisely so NULL stays the only spelling of "off"; a
 *    second spelling is one this screen and the call path would read
 *    differently. Same rule `setAlertPhoneAction` follows for `alert_phone`.
 *
 * ② WHAT IS STORED IS `toE164(input)` OR NULL, never a raw string. The
 *    handoff TeXML interpolates this column into an XML document UNESCAPED,
 *    which is safe only because every value in it has passed E.164 — the
 *    validation here and the CHECK behind it are that safety, not a nicety.
 *
 * ③ THE OWNED-NUMBER GUARD RUNS AT SAVE TIME, against the same source, the
 *    same `testing`/`live` filter and the same `resolveHandoffTarget` the
 *    call path uses (`api/voice/texml/handoff/route.ts`). NOT
 *    `resolveSmsSender`: that helper answers `no_live_number` for an account
 *    holding only a `testing` number — the shape of every account still
 *    walking the setup wizard, i.e. exactly who this ships to first — so the
 *    guard would silently not run for them, the save would look clean, and
 *    the caller would be the one to discover it, mid-call, as a hangup. The
 *    operator finds out now instead, in words they can act on.
 *
 * The read fails CLOSED (refuse the save) where the call path's equivalent
 * fails closed too. That direction is only correct because it is a save: the
 * operator sees the refusal and presses the button again. Clearing skips the
 * read entirely — turning the feature off cannot loop anybody anywhere, and
 * the off switch must not be gated on something that can be down.
 */
export async function setTransferPhoneAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["voice.agencyOnly"] };

  const raw = String(formData.get("transfer_phone") ?? "").trim();
  const transferPhone = raw ? toE164(raw) : null;
  if (raw && !transferPhone) return { ok: false, error: m["voice.transfer.badE164"] };

  if (transferPhone) {
    let owned: string[];
    try {
      const rows = await listPhoneNumbersForAccount(serviceDb(), accountId);
      owned = rows
        .filter((n) => n.status === "testing" || n.status === "live")
        .map((n) => n.e164);
    } catch (e) {
      console.error(`setTransferPhoneAction: owned-number read failed for account ${accountId}: ${String(e)}`);
      return { ok: false, error: m["voice.transfer.saveFailed"] };
    }
    // The call path's own function, not a second copy of its rule: if these
    // two ever disagree, a number saves cleanly here and loops the caller
    // back into Sofía at call time.
    const target = resolveHandoffTarget(transferPhone, owned);
    if (!target.available && target.reason === "own-number") {
      return { ok: false, error: m["voice.transfer.ownNumber"] };
    }
  }

  try {
    await setTransferPhone(serviceDb(), accountId, transferPhone, userId);
  } catch (e) {
    console.error(`setTransferPhoneAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["voice.transfer.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/voice`);
  return { ok: true };
}
