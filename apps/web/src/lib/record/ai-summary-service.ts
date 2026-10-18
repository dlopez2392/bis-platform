import type { AiGate, RecordSummaryClaim, RecordSummaryRow } from "@bis/db";
import type { AiMessage, AiResult } from "@/lib/ai/gateway";
import { aiSafeError } from "@/lib/ai/log";
import { inputDigest, type SummaryInputs } from "./ai-summary-inputs";
import { cleanSummary, summaryMessages, SUMMARY_PROMPT_VERSION } from "./ai-summary-prompt";
import { RECORD_SUMMARY_DAILY_CAP, type AiSummaryResponse } from "./ai-summary-view";

/**
 * Item 8a-2 (spec 4.2, 4.4-4.6; plan deviations 2, 3, 21, 22): what one open (or one Regenerate) of the
 * record summary answers. NEVER throws. The gate first: switched off or over budget is none, even with a
 * fresh cached paragraph (G6); an unreadable gate is none (I9). Then the cache (read under the reader's RLS):
 * an unchanged digest is served. Past the day's cap a fresh paragraph is served and anything else is capped.
 * Then one claim: one reader wins the lease and writes; the others answer generating. The gateway reads
 * the gate again and writes the ledger row; a refusal there releases the lease. Logs ids and state words
 * only, never the inputs or the answer.
 */
export type SummaryDeps = {
  gate(): Promise<AiGate>;
  cached(): Promise<RecordSummaryRow | null>;
  claim(digest: string, force: boolean): Promise<RecordSummaryClaim>;
  complete(messages: AiMessage[]): Promise<AiResult>;
  save(s: { leaseId: string; body: string; digest: string; generatedAt: string }): Promise<boolean>;
  release(leaseId: string): Promise<void>;
  now(): Date;
  log(line: string): void;
};
/** Configuration, not a fault (orchestrator ruling M7): nothing is shown. Everything else non-ok is "failed". */
const QUIET = new Set(["global_off", "account_off", "over_budget", "no_key", "unknown_model"]);

export async function serveRecordSummary(
  deps: SummaryDeps, a: { inputs: SummaryInputs; language: "en" | "es"; force: boolean; stamp: (iso: string) => string },
): Promise<AiSummaryResponse> {
  const ready = (text: string, generatedAt: string): AiSummaryResponse => ({ state: "ready", text, generatedAt, language: a.language, stamp: a.stamp(generatedAt) });
  const servable = (row: RecordSummaryRow | null) => (row?.body && row.generatedAt ? row as { body: string; generatedAt: string } : null);
  let gate: AiGate;
  try {
    gate = await deps.gate();
  } catch (e) {
    deps.log(`gate unreadable, no summary: ${aiSafeError(e)}`);
    return { state: "none" };
  }
  if (!gate.globalEnabled || !gate.accountEnabled || gate.monthSpendMicroUsd >= gate.budgetMicroUsd) return { state: "none" };
  let lease: string | null = null;
  try {
    const digest = inputDigest(a.inputs, SUMMARY_PROMPT_VERSION);
    const row = await deps.cached();
    const have = servable(row);
    const fresh = have !== null && row!.inputDigest === digest;
    if (fresh && !a.force) return ready(have.body, have.generatedAt);
    if (gate.recordSummariesToday >= RECORD_SUMMARY_DAILY_CAP) return fresh ? ready(have!.body, have!.generatedAt) : { state: "capped" };
    const claim = await deps.claim(digest, a.force);
    if (claim.status === "busy") return { state: "generating" };
    if (claim.status === "fresh" || claim.status === "too_soon") {
      const now = servable(await deps.cached()) ?? have;
      return now ? ready(now.body, now.generatedAt) : { state: "generating" };
    }
    lease = claim.leaseId;
    const answer = await deps.complete(summaryMessages(a.inputs, a.language));
    const body = answer.ok ? cleanSummary(answer.text) : null;
    if (!answer.ok || body === null) {
      const held = lease;
      lease = null;
      const quiet = !answer.ok && QUIET.has(answer.reason);
      // A release that throws never turns a quiet refusal into an error (ruling M11): the lease lapses in 30 s.
      try {
        await deps.release(held);
      } catch (e) {
        deps.log(`lease release failed: ${aiSafeError(e)}`);
      }
      return { state: quiet ? "none" : "failed" };
    }
    const generatedAt = deps.now().toISOString();
    const saved = await deps.save({ leaseId: lease, body, digest, generatedAt });
    lease = null;
    if (!saved) deps.log("lease lapsed before the save; showing this answer, not storing it");
    return ready(body, generatedAt);
  } catch (e) {
    deps.log(`summary failed: ${aiSafeError(e)}`);
    if (lease) await deps.release(lease).catch(() => {});
    return { state: "failed" };
  }
}
