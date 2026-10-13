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
 *
 * C6 note (stated as intended): a form whose own default locale is Spanish, served to a submitter on
 * an English account, counts as a Spanish signal — the form's chosen default is the business's own
 * proxy for the page's language, exactly as C6 reads it live; the backfill does not second-guess it.
 *
 * Every row is untrusted input (the evidence file is read from stored data, not re-derived), so `kind`
 * is checked against the closed set before anything is read from the row, and is never copied from the
 * input into the generated SQL — only the two literal strings "form"/"call" this module writes itself
 * ever reach `PlannedSignal.source`.
 */
export type FormEvidence = { kind: "form"; accountId: string; contactId: string; at: string; locale: string | null; accountLanguage: "en" | "es" | null };
export type CallEvidence = {
  kind: "call"; accountId: string; contactId: string; at: string; callerText: string | null;
  /** Cheap extra filter, when the export can supply it: a call that never reached someone (spam,
   *  abandoned, transferred) is not meaningful evidence of the CALLER's language. Optional — when
   *  absent, the export's own `outcome in ('booked','lead','message')` filter is the only gate. */
  outcome?: string | null;
};
export type Evidence = FormEvidence | CallEvidence;
export type PlannedSignal = { accountId: string; contactId: string; language: "en" | "es"; source: "form" | "call"; at: string };
export type DropCounts = { badId: number; badKind: number; badTime: number; unknownLocale: number; unclearCall: number; nonMeaningfulCall: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MEANINGFUL_CALL_OUTCOMES = new Set(["booked", "lead", "message"]);

function emptyDropCounts(): DropCounts {
  return { badId: 0, badKind: 0, badTime: 0, unknownLocale: 0, unclearCall: 0, nonMeaningfulCall: 0 };
}

/**
 * 0076's `record_language_signal` raises SQLSTATE 22023 on a `p_at` more than a day ahead of now
 * (commit 6888f317); one such row in the batch file would abort every statement after it, since the
 * MCP applies the file as one transaction. So a `p_at` that cannot parse, or that outruns "now plus a
 * day" AT PLAN TIME, is dropped here rather than risk the batch — counted under `badTime`.
 */
function planWithReport(evidence: readonly Evidence[]): { signals: PlannedSignal[]; dropped: DropCounts } {
  const out: PlannedSignal[] = [];
  const dropped = emptyDropCounts();
  const horizon = Date.now() + ONE_DAY_MS;
  for (const e of evidence) {
    // `kind` is checked before anything else: a value outside the closed set is dropped, and the
    // row's own `kind` is never the thing written into the generated SQL (see backfillSql) — this
    // same check is what lets TypeScript narrow `e` below, so the two can never drift apart.
    if (e.kind !== "form" && e.kind !== "call") { dropped.badKind++; continue; }
    if (!UUID.test(e.accountId) || !UUID.test(e.contactId)) { dropped.badId++; continue; }
    const ms = Date.parse(e.at);
    if (!Number.isFinite(ms) || ms > horizon) { dropped.badTime++; continue; }
    const at = new Date(ms).toISOString();

    if (e.kind === "form") {
      if (e.locale !== "en" && e.locale !== "es") { dropped.unknownLocale++; continue; }
      const language = pageLanguageSignal(e.locale, e.accountLanguage);
      if (language) out.push({ accountId: e.accountId, contactId: e.contactId, language, source: "form", at });
      continue; // locale equals the account's own default: a legitimate no-signal, not a drop
    }

    if (e.outcome != null && !MEANINGFUL_CALL_OUTCOMES.has(e.outcome)) { dropped.nonMeaningfulCall++; continue; }
    const text = e.callerText?.trim();
    const language = text ? clearCallerLanguage([{ role: "caller", text, at: "" }]) : null;
    if (!language) { dropped.unclearCall++; continue; }
    out.push({ accountId: e.accountId, contactId: e.contactId, language, source: "call", at });
  }
  out.sort((a, b) => (a.contactId < b.contactId ? -1 : a.contactId > b.contactId ? 1 : 0) || Date.parse(a.at) - Date.parse(b.at));
  return { signals: out, dropped };
}

export function planLanguageBackfill(evidence: readonly Evidence[]): PlannedSignal[] {
  return planWithReport(evidence).signals;
}

/** Same plan, plus how many rows were dropped and why — for the script's printed counts. */
export function planLanguageBackfillReport(evidence: readonly Evidence[]): { signals: PlannedSignal[]; dropped: DropCounts } {
  return planWithReport(evidence);
}

/**
 * One statement per sign; the event row exists only when the function set the language, and its
 * `created_at` is pinned to the evidence's own time (not `now()`, the column's default) — otherwise a
 * backfill of 50+ contacts floods the newest-50-events read the dashboard activity card uses, and a
 * real recent event never shows. Every value is a checked uuid, one of two literal words this module
 * writes itself, or an ISO time already round-tripped through `Date.parse`/`toISOString`, so nothing
 * here can carry a quote.
 */
export function backfillSql(signals: readonly PlannedSignal[]): string {
  return signals.map((s) =>
    "insert into public.events (account_id, type, actor_type, actor_id, payload, created_at) " +
    `select '${s.accountId}', 'contact.language_set', 'system', 'backfill-0076', jsonb_build_object('contactId', '${s.contactId}', 'language', '${s.language}', 'source', '${s.source}'), '${s.at}' ` +
    `where public.record_language_signal('${s.accountId}', '${s.contactId}', '${s.language}', '${s.source}', '${s.at}');\n`).join("");
}

/**
 * Splits the plan into one SQL string per chunk, never splitting one contact's signals across two
 * chunks (`signals` is already sorted contact-by-contact, oldest evidence first, by `planLanguageBackfill`).
 * Applying the files IN ORDER matters only for a contact whose own evidence spans two files, which
 * cannot happen here; applying them out of order is still safe (see `backfillSql`'s header + the
 * script's own note: a refused statement rolls back only its own file, and record_language_signal
 * returning false on an already-set contact makes re-applying any file idempotent).
 */
export function backfillSqlChunks(signals: readonly PlannedSignal[], chunkSize: number): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("chunkSize must be a positive integer");
  const chunks: PlannedSignal[][] = [];
  let current: PlannedSignal[] = [];
  let contactsInCurrent = 0;
  let lastContactId: string | null = null;
  for (const s of signals) {
    if (s.contactId !== lastContactId) {
      if (contactsInCurrent >= chunkSize) {
        chunks.push(current);
        current = [];
        contactsInCurrent = 0;
      }
      contactsInCurrent++;
      lastContactId = s.contactId;
    }
    current.push(s);
  }
  if (current.length) chunks.push(current);
  return chunks.map((c) => backfillSql(c));
}

export function backfillCounts(signals: readonly PlannedSignal[]) {
  return {
    contacts: new Set(signals.map((s) => s.contactId)).size, signals: signals.length,
    es: signals.filter((s) => s.language === "es").length, en: signals.filter((s) => s.language === "en").length,
    form: signals.filter((s) => s.source === "form").length, call: signals.filter((s) => s.source === "call").length,
  };
}
