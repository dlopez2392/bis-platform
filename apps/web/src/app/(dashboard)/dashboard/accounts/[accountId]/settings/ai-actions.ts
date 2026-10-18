"use server";

/**
 * The agency's AI card (item 8a-1, spec 3.3, 3.6). requireAgencyOnlyAccountAccess is the FIRST line of every
 * action: Settings is agency-only, but a server action is a public POST endpoint, so each guards itself (hiding
 * the card is not authorization). The account id is bound server-side by ai-section.tsx and never travels as a
 * form field. Writes go through serviceDb() (0086 grants authenticated SELECT only), and only after the guard.
 * Each answers the PRIOR value it replaced, which is what the toast's Undo writes back.
 */
import { MAX_MONTHLY_BUDGET_CENTS, getAiSettings, serviceDb, setAccountAiSettings, setGlobalAiEnabled } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { loggableError } from "@/lib/loggable-error";
import { isConfirmWord, parseBudgetDollars } from "@/lib/ai/settings-view";

export type AiPrior = { enabled: boolean; monthlyBudgetCents: number };
export type AiSaveResult = { ok: true; prior: AiPrior } | { ok: false; error: "aiSettings.error.budget" | "aiSettings.error.failed" };
export type AiGlobalResult = { ok: true; prior: boolean } | { ok: false; error: "aiSettings.global.wrongWord" | "aiSettings.error.failed" };

const FAILED = { ok: false as const, error: "aiSettings.error.failed" as const };

async function writeAccount(accountId: string, userId: string, next: AiPrior): Promise<AiSaveResult> {
  const db = serviceDb();
  try {
    const before = await getAiSettings(db, accountId);
    await setAccountAiSettings(db, accountId, { ...next, actorId: userId });
    return { ok: true, prior: { enabled: before.accountEnabled, monthlyBudgetCents: before.monthlyBudgetCents } };
  } catch (e) {
    console.error(`ai settings: save failed for account ${accountId}: ${loggableError(e)}`);
    return FAILED;
  }
}

export async function saveAccountAiAction(accountId: string, input: { enabled: boolean; budget: string }): Promise<AiSaveResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const cents = parseBudgetDollars(input?.budget);
  if (cents === null) return { ok: false, error: "aiSettings.error.budget" };
  if (typeof input.enabled !== "boolean") return FAILED;
  return writeAccount(accountId, userId, { enabled: input.enabled, monthlyBudgetCents: cents });
}

export async function undoAccountAiAction(accountId: string, prior: AiPrior): Promise<AiSaveResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const c = prior?.monthlyBudgetCents;
  if (typeof prior?.enabled !== "boolean" || !Number.isInteger(c) || c < 0 || c > MAX_MONTHLY_BUDGET_CENTS) return FAILED;
  return writeAccount(accountId, userId, { enabled: prior.enabled, monthlyBudgetCents: c });
}

export async function setGlobalAiAction(accountId: string, input: { enabled: boolean; confirm?: string }): Promise<AiGlobalResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  if (typeof input?.enabled !== "boolean") return FAILED;
  // Rule 6: turning AI off for EVERY account is the one destructive-in-effect act here; turning it on is not.
  if (!input.enabled && !isConfirmWord(input.confirm)) return { ok: false, error: "aiSettings.global.wrongWord" };
  const db = serviceDb();
  try {
    const before = await getAiSettings(db, accountId);
    await setGlobalAiEnabled(db, { enabled: input.enabled, actorId: userId });
    return { ok: true, prior: before.globalEnabled };
  } catch (e) {
    console.error(`ai settings: global switch failed (from account ${accountId}): ${loggableError(e)}`);
    return FAILED;
  }
}
