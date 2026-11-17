"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serviceDb, subscribeToBrief, unsubscribeFromBrief, DAILY_BRIEF_ROLES } from "@bis/db";
import { myMembership } from "@/lib/owner-line/memberships";
import { loggableError } from "@/lib/loggable-error";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The daily brief's switch (plan docs/superpowers/plans/2026-11-15-daily-owner-brief.md, D1-D3). NO person id
 * parameter, by design: auth() is the only source of whose subscription this touches, and the business named must be
 * one of THAT person's memberships, in a role the brief is offered to (DAILY_BRIEF_ROLES: Owner and Staff; a
 * Technician is refused like a non-member, D1). An impersonation session (Clerk's act claim, `actor`) is refused
 * before anything is read, as the owner line's setup actions do: it would look like that person and opt them in to a
 * daily email. Merging this is what turns the feature on.
 *
 * Turning it ON is subscribeToBrief (idempotent), OFF is unsubscribeFromBrief by person and business, idempotent
 * too, so the toast's Undo is the same call with the other value and a double click is harmless. Writes go through
 * serviceDb(): the table has no client grant.
 */
export type DailyBriefResult = { ok: true } | { ok: false; error: string };

const lc = (l: Locale): Locale => (l === "es" ? "es" : "en");
const fail = (locale: Locale, key: keyof typeof m): DailyBriefResult => ({ ok: false, error: t(m, key, lc(locale)) });

export async function setMyDailyBriefAction(accountId: string, on: boolean, locale: Locale = "en"): Promise<DailyBriefResult> {
  const { userId, actor } = await auth();
  if (!userId) redirect("/sign-in");
  if (actor) redirect("/no-access?reason=none");
  // The browser sends these two values and nothing else; refuse anything that is not exactly what the card sends.
  if (typeof accountId !== "string" || typeof on !== "boolean") return fail(locale, "dailyBrief.error.notMember");
  try {
    const db = serviceDb();
    const mine = await myMembership(db, userId, accountId);
    if (!mine || !(DAILY_BRIEF_ROLES as readonly string[]).includes(mine.role)) return fail(locale, "dailyBrief.error.notMember");
    if (on) await subscribeToBrief(db, { userId: mine.userId, accountId: mine.accountId });
    else await unsubscribeFromBrief(db, { userId: mine.userId, accountId: mine.accountId });
  } catch (e) {
    console.error(`preferences: daily brief ${on ? "on" : "off"} failed, accountId ${accountId}: ${loggableError(e)}`);
    return fail(locale, "dailyBrief.error.failed");
  }
  revalidatePath("/dashboard/preferences");
  return { ok: true };
}
