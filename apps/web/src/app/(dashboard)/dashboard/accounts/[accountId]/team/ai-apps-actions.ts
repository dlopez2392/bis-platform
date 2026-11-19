"use server";

import { serviceDb, setAiAppsSwitch, type AiAppsSwitchState } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { myMembership } from "@/lib/owner-line/memberships";
import { loggableError } from "@/lib/loggable-error";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The AI apps switch (plan docs/superpowers/plans/2026-11-19-mcp-server.md D2, 3.4). Customer names and numbers leave
 * BIS for the AI app's maker, so ONLY the business's own Owner may move it: not Staff, not a Technician and, unlike the
 * owner line's switch, not the agency (requireAccountOwner would admit it, so this uses requireAccountAccess).
 *
 * Two checks, both on the account asked. The guard sends another business's person away and an agency login is
 * refused here by name; then the person's own account-scope membership in THIS account is read on serviceDb() and its
 * role must be "owner". That row also gives the `users.id` the write records (the database refuses a changed_by who is
 * not an Owner of the account, 23514, so a bug above this line cannot write a stranger).
 *
 * OFF is protective (it stops every person's next read, plan 3.4), so it passes the guard's allow-while-paused option
 * (READ_ONLY_ALLOWED in lib/billing/read-only.test.ts); ON calls the guard with no option and stays refused while the
 * account is paused. Because OFF may run while paused, the action does not revalidate: the card renders the state this
 * action returns. Undo is the same action with the other value, and a request for the state the switch is already in
 * writes nothing (setAiAppsSwitch).
 */
export type AiAppsSwitchResult = { ok: true; value: AiAppsSwitchState } | { ok: false; error: string };

const lc = (l: Locale): Locale => (l === "es" ? "es" : "en");
const fail = (locale: Locale, key: "aiApps.error.ownerOnly" | "aiApps.error.failed"): AiAppsSwitchResult =>
  ({ ok: false, error: t(m, key, lc(locale)) });

export async function setAiAppsSwitchAction(accountId: string, locale: Locale, on: boolean): Promise<AiAppsSwitchResult> {
  const { userId, isAgency } = on === false
    ? await requireAccountAccess(accountId, { duringPause: "allow" })
    : await requireAccountAccess(accountId);
  // The browser sends this value: a string "false" would otherwise read as ON (on === false above is exact).
  if (typeof on !== "boolean") throw new Error("setAiAppsSwitchAction: on must be true or false");
  if (isAgency) return fail(locale, "aiApps.error.ownerOnly");
  const db = serviceDb();
  try {
    const mine = await myMembership(db, userId, accountId);
    if (!mine || mine.role !== "owner") return fail(locale, "aiApps.error.ownerOnly");
    const { state } = await setAiAppsSwitch(db, accountId, on, mine.userId);
    return { ok: true, value: state };
  } catch (e) {
    console.error(`team: AI apps switch ${on ? "on" : "off"} failed, accountId ${accountId}: ${loggableError(e)}`);
    return fail(locale, "aiApps.error.failed");
  }
}
