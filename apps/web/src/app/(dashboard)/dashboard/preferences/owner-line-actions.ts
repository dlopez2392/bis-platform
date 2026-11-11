"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  serviceDb, getPhoneNumberByE164, readMyOwnerLineEnrollment, startOwnerLineVerification, setOwnerLinePin,
  removeOwnerLinePin, removeOwnerLineEnrollment, OWNER_LINE_VERIFY_MINUTES,
} from "@bis/db";
import { myMembership, type MyMembership } from "@/lib/owner-line/memberships";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { checkPin, hashPin, newVerifyCode, hashVerifyCode, pinPepperConfigured } from "@/lib/owner-line/secrets";
import { e164Of } from "@/lib/voice/phone-number";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * "Call in to your business" (F-032 §3.1, §3.2; plan SC-4). NO person id parameter, by design: auth() is the only
 * source of the row these actions touch, and the business named must be one of THAT person's memberships, in a role
 * the owner line is offered to (OWNER_LINE_ROLES: Owner and Staff under the decided data path, O-1 = F2; a
 * Technician is refused like a non-member). Writes go through serviceDb() (the table has no client grant).
 * What goes back to the browser: the fresh call-in code, once, to the person who asked for it (the card shows it,
 * §3.2), and nothing else secret. Never the PIN, never either hash, and nothing here logs any of them.
 */
export type OwnerLineResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const lc = (l: Locale): Locale => (l === "es" ? "es" : "en");
const fail = (locale: Locale, key: keyof typeof m): { ok: false; error: string } => ({ ok: false, error: t(m, key, lc(locale)) });

/**
 * The signed-in person's current membership of this business, in ANY role. Only "Stop calling in" uses it alone.
 * Every setup action authorises HERE. An impersonation session (Clerk's act claim, `actor` on auth()) is refused before
 * anything is read: it would look like that person and enrol, or remove, their cell (owner ruling 2026-11-09;
 * lib/auth.ts:69's pattern, which the Team switch already gets through requireAccountOwner).
 */
async function member(accountId: string): Promise<MyMembership | null> {
  const { userId, actor } = await auth();
  if (!userId) redirect("/sign-in");
  if (actor) redirect("/no-access?reason=none");
  return myMembership(serviceDb(), userId, accountId);
}

/** The same, in a role the owner line is offered to: enrol, verify, set or change a PIN, remove the PIN. */
async function me(accountId: string): Promise<MyMembership | null> {
  const mine = await member(accountId);
  return mine && OWNER_LINE_ROLES.includes(mine.role) ? mine : null;
}

export async function startOwnerLineVerificationAction(
  accountId: string, locale: Locale, cell: string,
): Promise<OwnerLineResult<{ code: string; expiresAt: string }>> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  const e164 = e164Of(cell);
  if (!e164) return fail(locale, "ownerLine.error.cell");
  const db = serviceDb();
  if (await getPhoneNumberByE164(db, e164)) return fail(locale, "ownerLine.error.cellIsBusiness");
  const existing = await readMyOwnerLineEnrollment(db, accountId, mine.userId);
  if (existing?.verifiedAt && existing.e164 === e164) return fail(locale, "ownerLine.error.alreadyVerified");
  const code = newVerifyCode();
  const started = await startOwnerLineVerification(db, accountId, mine.userId, e164, hashVerifyCode(code));
  if (started === "taken") return fail(locale, "ownerLine.error.cellTaken");
  // Five codes a day per person per business (0115 I-2): past that the database stored NOTHING, so the code minted
  // above could never verify and is never shown.
  if (started === "too_many") return fail(locale, "ownerLine.error.tooManyCodes");
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: { code, expiresAt: new Date(Date.now() + OWNER_LINE_VERIFY_MINUTES * 60_000).toISOString() } };
}

export async function setOwnerLinePinAction(accountId: string, locale: Locale, pin: string): Promise<OwnerLineResult> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  const check = checkPin(pin.trim());
  if (!check.ok) return fail(locale, `ownerLine.error.pin.${check.reason}` as keyof typeof m);
  // No pepper is a deployment fault (O-3), never a reason to store an unpeppered hash.
  if (!pinPepperConfigured()) return fail(locale, "ownerLine.error.notReady");
  if (!(await setOwnerLinePin(serviceDb(), accountId, mine.userId, await hashPin(pin.trim())))) {
    return fail(locale, "ownerLine.error.notVerified");
  }
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: null };
}

export async function removeOwnerLinePinAction(accountId: string, locale: Locale): Promise<OwnerLineResult> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  await removeOwnerLinePin(serviceDb(), accountId, mine.userId);
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: null };
}

/**
 * "Stop calling in": deletes the person's own enrolment. Protective, so ANY current member may do it, a Technician
 * included (Staff demoted after enrolling must still be able to shut their own access; coordinator fix 2). Still
 * keyed on auth() and still refused for a business the person is not on.
 */
export async function removeOwnerLineCellAction(accountId: string, locale: Locale): Promise<OwnerLineResult> {
  const mine = await member(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  await removeOwnerLineEnrollment(serviceDb(), accountId, mine.userId);
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: null };
}
