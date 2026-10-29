"use server";

import { revalidatePath } from "next/cache";
import { serviceDb } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { makeTr, type Tr } from "@/lib/record/copy";
import { renderZone } from "@/lib/zone";
import type { SuggestionActionResult, UndoResult } from "@/components/proposals/suggestion-handlers";
import {
  acceptSuggestion, discardSuggestion, undoSuggestion, revalidateFor,
  type DecideDeps, type DecisionTarget, type EditInput,
} from "./decide";

/**
 * The four suggestion actions (item 8b-1, spec 4.4). Both audiences decide (`requireAccountAccess`,
 * not the agency-only variant). The order, stated (plan fix M13): `requireAccountAccess`, the REQUEST
 * client, the account row (zone and language) on it, the person's own language, the locale and the
 * zone, and only then the SERVICE client, which decide.ts uses solely for `proposals` writes after the
 * request client's read (RLS) found the row: this is the one file under lib/proposals that builds it
 * (in-account-service-reads.test.ts lists it as proven-target).
 *
 * Every answer is in the reader's stored language (plan fix M14). A server action has no searchParams,
 * so the QA `?locale=` override does not reach it; a real reader's `users.language` does.
 */

/** What the edit form may post; anything else (a `field`, an `opportunityId`) never reaches a kind. */
const EDIT_KEYS = ["title", "dueAt", "value", "toStageId"] as const;

type Answer = { ok: true; target: DecisionTarget } | { ok: false };

async function run<R extends Answer>(
  accountId: string, label: string, id: string,
  decide: (deps: DecideDeps) => Promise<R>,
): Promise<Exclude<R, { target: DecisionTarget }> | Omit<Extract<R, { ok: true }>, "target"> | { ok: false; error: string }> {
  // Outside the try: its redirect() is a thrown signal Next must see, never a "didn't go through".
  // F-118 part 1: /dashboard/work binds these four for every account and is not gated (owner ruling 3, plan C11).
  const access = await requireAccountAccess(accountId, { agencyVisit: "not-required" });
  let tr: Tr = makeTr("en");
  let outcome: R;
  try {
    const db = await dbForRequest();
    const { data: account, error } = await db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`account read failed: ${error.message}`);
    // getPersonPrefs() never rejects: a failed read means defaults (its own doc comment).
    const prefs = await getPersonPrefs();
    const accountLanguage = { language: (account?.language as Locale | null | undefined) ?? null };
    const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language });
    tr = makeTr(locale);
    const { zone } = await renderZone((account?.timezone as string | null | undefined) ?? undefined);
    const writer = serviceDb();
    outcome = await decide({ db, writer, accountId, userId: access.userId, now: new Date(), zone, tr });
  } catch (e) {
    console.error(`${label}: failed for proposal ${id} (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, error: tr.text("suggestions.answer.failed") };
  }
  if (!outcome.ok) return outcome as Exclude<R, { target: DecisionTarget }>;
  const { target, ...answer } = outcome as Extract<R, { ok: true }>;
  // The decision stands whatever happens here: a failed revalidation is logged, never reported.
  for (const path of revalidateFor(accountId, target)) {
    try {
      revalidatePath(path);
    } catch (e) {
      console.error(`${label}: revalidatePath failed for proposal ${id} (account ${accountId}): ${loggableError(e)}`);
    }
  }
  return answer as Omit<Extract<R, { ok: true }>, "target">;
}

export async function acceptSuggestionAction(accountId: string, id: string): Promise<SuggestionActionResult> {
  return run(accountId, "acceptSuggestionAction", id, (d) => acceptSuggestion(d, id));
}

export async function editAcceptSuggestionAction(
  accountId: string, id: string, edit: Record<string, string>,
): Promise<SuggestionActionResult> {
  const picked: EditInput = {};
  for (const k of EDIT_KEYS) {
    const v: unknown = edit?.[k];
    if (typeof v === "string") picked[k] = v;
  }
  return run(accountId, "editAcceptSuggestionAction", id, (d) => acceptSuggestion(d, id, picked));
}

export async function discardSuggestionAction(accountId: string, id: string): Promise<SuggestionActionResult> {
  return run(accountId, "discardSuggestionAction", id, (d) => discardSuggestion(d, id));
}

export async function undoSuggestionAction(accountId: string, id: string): Promise<UndoResult> {
  return run(accountId, "undoSuggestionAction", id, (d) => undoSuggestion(d, id));
}
