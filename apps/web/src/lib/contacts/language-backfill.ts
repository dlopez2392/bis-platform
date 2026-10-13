import { clearCallerLanguage } from "@/lib/voice/language";
import { pageLanguageSignal } from "@/lib/contacts/language";

/**
 * S-09 §18.3 (Q4): every existing contact's language, from the two kinds of stored evidence only:
 * form submissions (C6's page rule on their stored locale) and calls (the strict reading of the
 * caller's own words, never calls.language, C5). Bookings store no language. Each contact's evidence
 * is replayed OLDEST first through record_language_signal: the first sign sets the language, the
 * newest is the last sign, so a contact whose history disagrees shows its hint. Pure: the
 * orchestrator reads the evidence and applies the SQL through the Supabase MCP (plan deviation 7).
 * `accountLanguage` is the account's language TODAY; what it was when the form was sent is not stored.
 */
export type FormEvidence = { kind: "form"; accountId: string; contactId: string; at: string; locale: string | null; accountLanguage: "en" | "es" | null };
export type CallEvidence = { kind: "call"; accountId: string; contactId: string; at: string; callerText: string | null };
export type Evidence = FormEvidence | CallEvidence;
export type PlannedSignal = { accountId: string; contactId: string; language: "en" | "es"; source: "form" | "call"; at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function signOf(e: Evidence): "en" | "es" | null {
  if (e.kind === "form") return e.locale === "en" || e.locale === "es" ? pageLanguageSignal(e.locale, e.accountLanguage) : null;
  return e.callerText?.trim() ? clearCallerLanguage([{ role: "caller", text: e.callerText, at: "" }]) : null;
}

/**
 * 0076's `record_language_signal` raises SQLSTATE 22023 on a `p_at` more than a day ahead of now
 * (commit 6888f317); one such row in the batch file would abort every statement after it, since the
 * MCP applies the file as one transaction. So a `p_at` that cannot parse, or that outruns "now plus a
 * day" AT PLAN TIME, is dropped here rather than risk the batch — `droppedForTime` counts both.
 */
function planWithReport(evidence: readonly Evidence[]): { signals: PlannedSignal[]; droppedForTime: number } {
  const out: PlannedSignal[] = [];
  let droppedForTime = 0;
  const horizon = Date.now() + ONE_DAY_MS;
  for (const e of evidence) {
    if (!UUID.test(e.accountId) || !UUID.test(e.contactId)) continue;
    const ms = Date.parse(e.at);
    if (!Number.isFinite(ms) || ms > horizon) { droppedForTime++; continue; }
    const language = signOf(e);
    if (language) out.push({ accountId: e.accountId, contactId: e.contactId, language, source: e.kind, at: new Date(ms).toISOString() });
  }
  out.sort((a, b) => (a.contactId < b.contactId ? -1 : a.contactId > b.contactId ? 1 : 0) || Date.parse(a.at) - Date.parse(b.at));
  return { signals: out, droppedForTime };
}

export function planLanguageBackfill(evidence: readonly Evidence[]): PlannedSignal[] {
  return planWithReport(evidence).signals;
}

/** Same plan, plus how many rows the future/invalid-time guard dropped — for the script's printed counts. */
export function planLanguageBackfillReport(evidence: readonly Evidence[]): { signals: PlannedSignal[]; droppedForTime: number } {
  return planWithReport(evidence);
}

/** One statement per sign; the event row exists only when the function set the language. Every value
 *  is a checked uuid, a fixed word or an ISO time, so nothing here can carry a quote. */
export function backfillSql(signals: readonly PlannedSignal[]): string {
  return signals.map((s) =>
    "insert into public.events (account_id, type, actor_type, actor_id, payload) " +
    `select '${s.accountId}', 'contact.language_set', 'system', 'backfill-0076', jsonb_build_object('contactId', '${s.contactId}', 'language', '${s.language}', 'source', '${s.source}') ` +
    `where public.record_language_signal('${s.accountId}', '${s.contactId}', '${s.language}', '${s.source}', '${s.at}');\n`).join("");
}

export function backfillCounts(signals: readonly PlannedSignal[]) {
  return {
    contacts: new Set(signals.map((s) => s.contactId)).size, signals: signals.length,
    es: signals.filter((s) => s.language === "es").length, en: signals.filter((s) => s.language === "en").length,
    form: signals.filter((s) => s.source === "form").length, call: signals.filter((s) => s.source === "call").length,
  };
}
