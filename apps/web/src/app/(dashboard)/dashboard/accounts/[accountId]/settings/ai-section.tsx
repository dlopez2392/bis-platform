import { countAiSkipsSince, firstOverBudgetSince, getAiSettings } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { aiCardView, type AiCardView } from "@/lib/ai/settings-view";
import { monthStartInZone, safeZone } from "@/lib/billing/billing-view";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale } from "@/lib/i18n/request-locale";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { saveAccountAiAction, setGlobalAiAction, undoAccountAiAction } from "./ai-actions";
import { AiCard, AiCardError } from "./ai-card";

export { AiCardSkeleton } from "./ai-card";

/**
 * Loads the AI card (spec 3.6). Runs INSIDE Settings, after its requireAgencyOnlyAccountAccess, and guards
 * again itself, OUTSIDE the try, so a redirect is never caught into the error card (billing-section.tsx's
 * reason). Reads on the agency's REQUEST client: 0086 lets the agency alone read the three tables (plan
 * deviation 14). Fails soft: an AI read failure never takes Settings offline.
 */
export async function AiSection({ accountId }: { accountId: string }) {
  await requireAgencyOnlyAccountAccess(accountId);
  let locale: Locale = "en";
  let view: AiCardView;
  try {
    const db = await dbForRequest();
    const [prefs, account] = await Promise.all([
      getPersonPrefs(),
      db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle().then(({ data, error }: { data: { timezone: string | null; language: string | null } | null; error: { message: string } | null }) => {
        if (error) throw new Error(`ai card: account read failed: ${error.message}`);
        if (!data) throw new Error("ai card: account not found");
        return data;
      }),
    ]);
    const raw = account.language;
    const language: Locale | null = raw === "en" || raw === "es" ? raw : null;
    // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces (branding/page.tsx:114-115).
    const accountLanguage = { language };
    locale = requestLocale({ account: accountLanguage, isOperator: true, userLanguage: prefs.language });
    const zone = safeZone(account.timezone);
    const now = new Date();
    const since = monthStartInZone(now, zone).toISOString();
    const [settings, refusals, overBudgetAt] = await Promise.all([
      getAiSettings(db, accountId), countAiSkipsSince(db, accountId, since), firstOverBudgetSince(db, accountId, since),
    ]);
    view = aiCardView({ settings, refusals, overBudgetAt, now, zone, locale });
  } catch (e) {
    console.error(`settings: AI card unavailable for account ${accountId}: ${loggableError(e)}`);
    return <AiCardError locale={locale} />;
  }
  // accountId is bound here, server-side. It never travels as a form field.
  // Keyed on the STORED switch and budget (review I8): after a Save or its Undo, router.refresh() re-renders this
  // section with the new stored values, the key changes, and the form's local state starts again from them, so an
  // Undo visibly puts the checkbox and the field back.
  return (
    <AiCard
      key={`${view.accountEnabled}:${view.budgetDollars}`}
      view={view}
      locale={locale}
      save={saveAccountAiAction.bind(null, accountId)}
      undo={undoAccountAiAction.bind(null, accountId)}
      setGlobal={setGlobalAiAction.bind(null, accountId)}
    />
  );
}
