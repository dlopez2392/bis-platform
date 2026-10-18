"use server";

/**
 * The agency's AI card (item 8a-1, spec 3.3, 3.6). requireAgencyOnlyAccountAccess is the FIRST line of every
 * action: Settings is agency-only, but a server action is a public POST endpoint, so each guards itself (hiding
 * the card is not authorization). The account id is an argument like any other (a caller can send any id), so
 * the guard checks exactly the id every read and write below uses. Writes go through serviceDb() (0086 grants
 * authenticated SELECT only), and only after the guard.
 *
 * Each action reads the stored values BEFORE it writes and answers them as `prior`; the account Save also answers
 * what it `wrote`. The toast's Undo writes `prior` back as a compare-and-set on what the action wrote (the repo's
 * Undo convention, documents.ts's CasOutcome): when someone saved after, the store answers "changed" and the Undo
 * answers "documents.undoChanged" ("Someone changed it after you, so nothing was undone."), the refusal the
 * Documents card's Undos already use, rather than clobbering the newer save.
 */
import { MAX_MONTHLY_BUDGET_CENTS, getAiSettings, serviceDb, setAccountAiSettings, setGlobalAiEnabled } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { loggableError } from "@/lib/loggable-error";
import { isConfirmWord, parseBudgetDollars } from "@/lib/ai/settings-view";

export type AiPrior = { enabled: boolean; monthlyBudgetCents: number };
export type AiSaveResult =
  | { ok: true; prior: AiPrior; wrote: AiPrior }
  | { ok: false; error: "aiSettings.error.budget" | "aiSettings.error.failed" | "documents.undoChanged" };
export type AiGlobalResult =
  | { ok: true; prior: boolean }
  | { ok: false; error: "aiSettings.global.wrongWord" | "aiSettings.error.failed" | "documents.undoChanged" };

const FAILED = { ok: false as const, error: "aiSettings.error.failed" as const };
const CHANGED = { ok: false as const, error: "documents.undoChanged" as const };

/** A value this card could have read or written: a real boolean and whole cents from 0 to the cap. */
function isAiPrior(p: unknown): p is AiPrior {
  const o = p as { enabled?: unknown; monthlyBudgetCents?: unknown } | null | undefined;
  const c = o?.monthlyBudgetCents;
  return typeof o?.enabled === "boolean" && typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= MAX_MONTHLY_BUDGET_CENTS;
}

async function writeAccount(accountId: string, userId: string, next: AiPrior, expected?: AiPrior): Promise<AiSaveResult> {
  const db = serviceDb();
  try {
    const before = await getAiSettings(db, accountId);
    const values = { enabled: next.enabled, monthlyBudgetCents: next.monthlyBudgetCents, actorId: userId };
    const outcome = expected === undefined
      ? await setAccountAiSettings(db, accountId, values)
      : await setAccountAiSettings(db, accountId, values, { enabled: expected.enabled, monthlyBudgetCents: expected.monthlyBudgetCents });
    if (outcome === "changed") return CHANGED;
    return {
      ok: true,
      prior: { enabled: before.accountEnabled, monthlyBudgetCents: before.monthlyBudgetCents },
      wrote: { enabled: next.enabled, monthlyBudgetCents: next.monthlyBudgetCents },
    };
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

/** Puts `prior` back only while the row still holds `wrote` (what the Save answered it wrote). */
export async function undoAccountAiAction(accountId: string, prior: AiPrior, wrote: AiPrior): Promise<AiSaveResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  if (!isAiPrior(prior) || !isAiPrior(wrote)) return FAILED;
  return writeAccount(accountId, userId, prior, wrote);
}

/**
 * The switch for every account. An Undo calls this too, with `expected` = the state the action it undoes wrote
 * (plan M12: undoing "on" turns it off again and passes the reader's word, which is still checked here).
 */
export async function setGlobalAiAction(
  accountId: string, input: { enabled: boolean; confirm?: string; expected?: boolean },
): Promise<AiGlobalResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  if (typeof input?.enabled !== "boolean") return FAILED;
  if (input.expected !== undefined && typeof input.expected !== "boolean") return FAILED;
  // Rule 6: turning AI off for EVERY account is the one destructive-in-effect act here; turning it on is not.
  if (!input.enabled && !isConfirmWord(input.confirm)) return { ok: false, error: "aiSettings.global.wrongWord" };
  const db = serviceDb();
  try {
    const before = await getAiSettings(db, accountId);
    const values = { enabled: input.enabled, actorId: userId };
    const outcome = input.expected === undefined
      ? await setGlobalAiEnabled(db, values)
      : await setGlobalAiEnabled(db, values, input.expected);
    if (outcome === "changed") return CHANGED;
    return { ok: true, prior: before.globalEnabled };
  } catch (e) {
    console.error(`ai settings: global switch failed (from account ${accountId}): ${loggableError(e)}`);
    return FAILED;
  }
}
