"use server";

import { revalidatePath } from "next/cache";
import { serviceDb, setOwnerLineSwitch, emitAgencyEvent, type OwnerLineSwitchState } from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * "Let your team call in to hear the day" (F-032 §3.3; plan SC-1; owner ruling Q-A). requireAccountOwner admits the
 * agency and a client Owner, and returns { userId, isAgency } (WEB/lib/auth.ts:104-110).
 *   - The client's Owner turns it on or off.
 *   - The agency may turn it OFF, a protective act (a lost phone, a person let go), and never ON: the client's Owner
 *     decides who may phone into their data.
 * Every change records WHEN and WHAT KIND of person (shown on the card: "Turned off by BIS"), never who (owner ruling
 * 2026-11-09). Which BIS person turned it off is BIS's own null-account event, read by the agency only. The switch is
 * written first: an OFF is protective, so a failed audit write must not leave it on; the error then surfaces.
 * serviceDb(): the three switch columns are server-only (0115), and the guard above stands in front of the write.
 */
export async function setOwnerLineSwitchAction(
  accountId: string, locale: Locale, on: boolean,
): Promise<{ ok: true; value: OwnerLineSwitchState } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountOwner(accountId);
  // The browser sends this value: a string "true" would otherwise read as OFF for an Owner (on === true below).
  if (typeof on !== "boolean") throw new Error("setOwnerLineSwitchAction: on must be true or false");
  if (on && isAgency) return { ok: false, error: t(m, "ownerLine.switch.agencyCannot", locale === "es" ? "es" : "en") };
  const db = serviceDb();
  const { changed, state } = await setOwnerLineSwitch(db, accountId, on, isAgency ? "agency" : "owner");
  // Only a real change is BIS's to record (re-review m-E): asking for the state it is already in wrote nothing.
  if (isAgency && changed) {
    await emitAgencyEvent(db, "owner_line.switch_off", userId, { account_id: accountId, changed_at: state.changedAt });
  }
  revalidatePath(`/dashboard/accounts/${accountId}/team`);
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: state };
}
