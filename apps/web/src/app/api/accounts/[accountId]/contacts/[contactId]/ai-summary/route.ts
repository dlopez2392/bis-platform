import { NextResponse } from "next/server";
import {
  aiGateCheck, claimRecordSummary, getContact, getRecordSummary, releaseRecordSummaryLease, saveRecordSummary, serviceDb,
} from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import { aiComplete, GATE_TIMEOUT_MS } from "@/lib/ai/gateway";
import { periodKeys } from "@/lib/ai/period";
import { safeZone } from "@/lib/billing/billing-view";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { buildSummaryInputs, hasSomethingToSay, type SummaryContact } from "@/lib/record/ai-summary-inputs";
import { SUMMARY_MAX_TOKENS, SUMMARY_MODEL, SUMMARY_TIMEOUT_MS } from "@/lib/record/ai-summary-prompt";
import { serveRecordSummary } from "@/lib/record/ai-summary-service";
import { aiSummaryStamp, type AiSummaryResponse } from "@/lib/record/ai-summary-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ accountId: string; contactId: string }> };

/**
 * The record page's AI summary (item 8a-2, spec 4.2). Authorisation first: getContact on the REQUEST client
 * is a 404 before anything else runs (the drawer route's order), so a Technician gets a summary only for an
 * assigned customer (0068). The inputs and the cache read run on the request client too (RLS decides). Only
 * after that proof, and only when there is something to say, does this file build the service client, for
 * the gate, the claim, the completion and the save. GET serves or writes; POST is Regenerate (forced). One
 * locale, one cache language (en | es); the pseudo-locale reaches the label only. A failure after the ids
 * checked out answers 200 { state: "failed" } (plan deviation 16): the card has one failure path.
 */
async function answer(req: Request, { params }: Params, force: boolean): Promise<NextResponse> {
  const { accountId, contactId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  // Both ids are checked (plan fix M5): an agency session passes apiAccountAccess for ANY accountId string
  // (lib/auth.ts), so a malformed one would otherwise reach the queries.
  if (!access || !isUuid(accountId) || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const contactId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER the service client before getContact proved the customer
  const failed = (where: string, e: unknown) => {
    console.error(`record summary: account ${accountId} contact ${contactId}: ${where}: ${loggableError(e)}`);
    return NextResponse.json({ state: "failed" } satisfies AiSummaryResponse);
  };
  let contact: SummaryContact | null;
  try {
    contact = (await getContact(db, accountId, contactId)) as SummaryContact | null;
  } catch (e) {
    return failed("contact read", e);
  }
  if (!contact) return NextResponse.json({}, { status: 404 });

  // The QA override the card forwards from the page URL; ignored outside BIS_I18N_QA.
  const localeParam = new URL(req.url).searchParams.get("locale") ?? undefined;
  const now = new Date();
  try {
    const [prefs, account] = await Promise.all([
      getPersonPrefs(),
      db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    ]);
    if (account.error) console.error(`record summary: account ${accountId} timezone and language read failed: ${account.error.message}`);
    const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
    const zone = (await renderZone(accountRow?.timezone)).zone;
    // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
    const accountLanguage = { language: accountRow?.language ?? null };
    const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
    const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

    const inputs = await buildSummaryInputs(db, { accountId, contact, zone, now });
    if (!hasSomethingToSay(inputs)) return NextResponse.json({ state: "none" } satisfies AiSummaryResponse);

    const svc = serviceDb();
    const key = { accountId, contactId, language: locale };
    const body = await serveRecordSummary({
      // The cap's day and the budget's month in the ACCOUNT's zone, through the same safeZone aiComplete uses,
      // so this gate and the gateway's own read the same day (never the UTC day).
      // M7a PR-4 (plan G21, M2): no model call for a paused account, on GET or POST, for any caller: the gate
      // answers "account AI off", which serveRecordSummary turns into { state: "none" } before its cache read.
      // Fails open (billingVerdictFor never throws; switch off, it reads nothing).
      gate: async () => {
        const g = await aiGateCheck(svc, { accountId, ...periodKeys(now, safeZone(zone)), signal: AbortSignal.timeout(GATE_TIMEOUT_MS) });
        return (await billingVerdictFor(accountId)).paused ? { ...g, accountEnabled: false } : g;
      },
      cached: () => getRecordSummary(db, key),
      claim: (digest, f) => claimRecordSummary(svc, { ...key, digest, force: f }),
      complete: (messages) => aiComplete(svc, {
        accountId, feature: "record_summary", model: SUMMARY_MODEL, messages, maxTokens: SUMMARY_MAX_TOKENS,
        timeoutMs: SUMMARY_TIMEOUT_MS, timezone: zone, language: locale, ref: `contact ${contactId}`,
      }),
      save: (s) => saveRecordSummary(svc, { ...key, ...s, model: SUMMARY_MODEL }),
      release: (leaseId) => releaseRecordSummaryLease(svc, { ...key, leaseId }),
      now: () => new Date(),
      log: (line) => console.error(`record summary: account ${accountId} contact ${contactId}: ${line}`),
    }, { inputs, language: locale, force, stamp: (iso) => aiSummaryStamp(iso, { zone, now: new Date(), tr }) });
    return NextResponse.json(body);
  } catch (e) {
    return failed("inputs", e);
  }
}

export function GET(req: Request, ctx: Params) { return answer(req, ctx, false); }
export function POST(req: Request, ctx: Params) { return answer(req, ctx, true); }
