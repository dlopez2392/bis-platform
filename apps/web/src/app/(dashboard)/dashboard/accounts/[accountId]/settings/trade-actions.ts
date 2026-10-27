"use server";

/**
 * The agency's Trade card on Settings (S-53, spec 5.2). Agency only: requireAgencyOnlyAccountAccess
 * redirects anyone else, and the write goes through serviceDb() because 0101 grants authenticated no
 * UPDATE on accounts.trade. Same validation as Add company (checkTradeChoice). Moving to a CRM-only
 * trade is refused while Sofía is answering or the web chat is on: the switch-on guards stop new
 * switch-ons, so only this path could otherwise leave a CRM-only company with Sofía live.
 *
 * A RACE, ACCEPTED (T4+T6 review m3): this is check-then-write, and so is every switch-on guard
 * (lib/vetting/sofia-guard.ts). Sent within milliseconds of each other - this save reading "Sofía is
 * off" while a Voice-page switch-on reads "the trade is still allowed" - both pass and the company ends
 * CRM-only with Sofía on. Accepted, not guaranteed against: both writers are agency staff, it takes two
 * actions in the same instant, and closing it needs the check inside the database (a trigger or a
 * locking function over accounts, voice_profiles and phone_numbers), which this release does not add.
 */
import { revalidatePath } from "next/cache";
import { serviceDb, setAccountTrade, getVoiceProfile, listPhoneNumbersForAccount } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { checkTradeChoice } from "@/lib/vetting/trades";
import { tradeChoiceRefusal } from "@/lib/vetting/copy";
import { sofiaIsOn } from "@/lib/vetting/sofia-state";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setTradeAction(accountId: string, formData: FormData): Promise<ActionResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const locale = formData.get("locale") === "es" ? "es" : "en";

  const check = checkTradeChoice(formData.get("trade"), formData.get("tradeOther"));
  if (!check.ok) return { ok: false, error: tradeChoiceRefusal(check, locale) };

  if (check.verdict === "crm_only") {
    let on: { answering: boolean; chat: boolean };
    try {
      const db = serviceDb();
      const [profile, numbers] = await Promise.all([getVoiceProfile(db, accountId), listPhoneNumbersForAccount(db, accountId)]);
      on = sofiaIsOn(profile, numbers);
    } catch (e) {
      console.error(`setTradeAction: Sofía state read failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, error: t(m, "vetting.saveFailed", locale) };
    }
    if (on.answering || on.chat) return { ok: false, error: t(m, "vetting.turnOffFirst", locale) };
  }

  try {
    await setAccountTrade(serviceDb(), accountId, check.choice, userId);
  } catch (e) {
    console.error(`setTradeAction: save failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: t(m, "vetting.saveFailed", locale) };
  }
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}
