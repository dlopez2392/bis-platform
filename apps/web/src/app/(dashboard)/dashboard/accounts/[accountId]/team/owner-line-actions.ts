"use server";

import { serviceDb, setOwnerLineSwitch, emitAgencyEvent, type OwnerLineSwitchState } from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import { loggableError } from "@/lib/loggable-error";
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
 *
 * A billing pause (lib/billing/read-only.ts) refuses a client's writes. Turning the line OFF is protective, so OFF
 * passes the guard's allow-while-paused option (READ_ONLY_ALLOWED in lib/billing/read-only.test.ts); ON calls the guard with no
 * option and stays refused while paused. The agency is never refused by a pause. Because the OFF may run while
 * paused, this action does NOT revalidate: a re-render inside the action's own request would meet the pause guard on
 * the Team page. The card renders the state this action returns (Task 6).
 */
export async function setOwnerLineSwitchAction(
  accountId: string, locale: Locale, on: boolean,
): Promise<{ ok: true; value: OwnerLineSwitchState } | { ok: false; error: string }> {
  const { userId, isAgency } = on === false
    ? await requireAccountOwner(accountId, { duringPause: "allow" })
    : await requireAccountOwner(accountId);
  // The browser sends this value: a string "true" would otherwise read as OFF for an Owner (on === true below).
  if (typeof on !== "boolean") throw new Error("setOwnerLineSwitchAction: on must be true or false");
  if (on && isAgency) return { ok: false, error: t(m, "ownerLine.switch.agencyCannot", locale === "es" ? "es" : "en") };
  const db = serviceDb();
  const { changed, state } = await setOwnerLineSwitch(db, accountId, on, isAgency ? "agency" : "owner");
  // Only a real change is BIS's to record (re-review m-E): asking for the state it is already in wrote nothing.
  if (isAgency && changed) await recordAgencyOff(db, accountId, userId, state.changedAt);
  return { ok: true, value: state };
}

/**
 * BIS's own record of which BIS person turned the switch off (review m-2). A retry of the ACTION cannot write it: the
 * switch is already off, so the retry changes nothing and records nothing. So the record itself is tried twice, and a
 * second failure leaves one server-side line naming the account and the event (never the person's Clerk id, which is
 * exactly what the client must not see by name), while the OFF, already written, stands and answers ok.
 */
async function recordAgencyOff(
  db: ReturnType<typeof serviceDb>, accountId: string, actorClerkUserId: string, changedAt: string | null,
): Promise<void> {
  const type = "owner_line.switch_off";
  const payload = { account_id: accountId, changed_at: changedAt };
  try {
    await emitAgencyEvent(db, type, actorClerkUserId, payload);
  } catch {
    try {
      await emitAgencyEvent(db, type, actorClerkUserId, payload);
    } catch (e) {
      console.error(`owner line: BIS's ${type} record for account ${accountId} failed twice; the switch is off: ${loggableError(e)}`);
    }
  }
}
