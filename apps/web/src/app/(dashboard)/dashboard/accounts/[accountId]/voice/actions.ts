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
  type PhoneNumberStatus, type VoiceProfilePatch,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { toE164 } from "@/lib/voice/phone-number";
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

  const patch: VoiceProfilePatch = {
    persona_name: String(formData.get("persona_name") ?? "").trim(),
    greeting_en: String(formData.get("greeting_en") ?? ""),
    greeting_es: String(formData.get("greeting_es") ?? ""),
    facts: String(formData.get("facts") ?? ""),
    services: String(formData.get("services") ?? ""),
    languages,
    booking_enabled: formData.get("booking_enabled") === "on",
    after_hours: afterHours,
    enabled: formData.get("enabled") === "on",
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
