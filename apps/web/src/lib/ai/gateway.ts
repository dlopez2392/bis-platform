import { AI_OUTCOMES, aiGateCheck, recordAiLedger, type AiFeature, type AiGate, type AiOutcome, type SupabaseClient } from "@bis/db";
import { safeZone } from "@/lib/billing/billing-view";
import { loggableError } from "@/lib/loggable-error";
import { costMicroUsd, estimatedTokens, isPricedModel } from "./prices";
import { periodKeys } from "./period";
import { providerFor } from "./providers/select";

/**
 * ONE DOOR for every model completion (item 8a-1, spec 3.1). Never throws: it answers the text, or a reason.
 * Every caller already has a non-AI form and maps every reason to it.
 *
 * Order: (1) AI_GATEWAY_OFF=1, no database read, no ledger row; (2) the model must be priced; (3) one gate read,
 * bounded at 3 s, failing CLOSED (choice I9); (4) the global switch, the account's, the budget (spend >= budget);
 * (5) the provider (the key is checked here), under the caller's time limit; (6) one ledger row, bounded at 3 s,
 * whose failure is logged and keeps the text (the call is already paid for). Steps 2-5's refusals write a
 * zero-cost row (choice I10). The ledger write is NEVER retried: a failed or timed-out write may still have
 * committed (recordAiLedger's own contract), and a retry could count the cost twice.
 *
 * The month and day keys are the account-zone date of `input.now ?? new Date()`, the real clock: 0086 accepts
 * any well-formed key and relies on the app never sending a far-future one.
 *
 * The client is the CALLER's: finishCall passes its service client (the two RPCs are service_role only). This
 * file never names a service-client getter (in-account-service-reads.test.ts scans lib/).
 *
 * Logged: the feature, the account id, the caller's id-only `ref`, the outcome, an HTTP status or an error's
 * class, and the latency. NEVER a message, a prompt, an answer, or an error message from the provider path.
 * Only non-ok outcomes log; the three expected states (switched off, over budget) on console.log so they never
 * read as alerts. Budget overshoot is bounded, not zero: concurrent calls that all passed the gate before any
 * recorded can overshoot by their own cost (spec 3.1). A TIMED-OUT request is recorded at zero cost, but the
 * provider may still have run it and may bill it: the ledger's estimate can undercount by those calls (review M11).
 */
export type AiMessage = { role: "system" | "user"; content: string };
export type AiRefusal = Exclude<AiOutcome, "ok">;
export const AI_REFUSALS: readonly AiRefusal[] = AI_OUTCOMES.filter((o): o is AiRefusal => o !== "ok");
export type AiUsage = { inputTokens: number | null; outputTokens: number | null; costMicroUsd: number };
export type AiResult = { ok: true; text: string; usage: AiUsage } | { ok: false; reason: AiRefusal };
export type AiInput = {
  accountId: string;
  feature: AiFeature;
  model: string;
  messages: AiMessage[];
  responseFormat?: { type: "json_object" };
  maxTokens?: number;
  timeoutMs: number;
  /** The account's IANA zone: the budget's month and the cap's day are the account's own (choice I7). */
  timezone: string;
  /** Only the fake reads it, for its label (spec 8.1). */
  language?: "en" | "es";
  /** An id-only reference for log lines, e.g. "call 1f2e...". NEVER text from a transcript or a record. */
  ref?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export const GATE_TIMEOUT_MS = 3_000;
export const LEDGER_TIMEOUT_MS = 3_000;
const NO_USAGE: AiUsage = { inputTokens: null, outputTokens: null, costMicroUsd: 0 };
const QUIET: ReadonlySet<AiOutcome> = new Set<AiOutcome>(["global_off", "account_off", "over_budget"]);

export async function aiComplete(db: SupabaseClient, input: AiInput): Promise<AiResult> {
  const started = Date.now();
  const who = `ai: ${input.feature} for account ${input.accountId}${input.ref ? ` (${input.ref})` : ""}`;
  const say = (outcome: AiOutcome, detail = "") => {
    const line = `${who}: ${outcome}${detail} after ${Date.now() - started} ms`;
    if (QUIET.has(outcome)) console.log(line); else console.error(line);
  };
  try {
    if (process.env.AI_GATEWAY_OFF === "1") {
      say("global_off", " (AI_GATEWAY_OFF)");
      return { ok: false, reason: "global_off" };
    }
    const keys = periodKeys(input.now ?? new Date(), safeZone(input.timezone));
    const finish = async (outcome: AiOutcome, usage: AiUsage, detail = ""): Promise<void> => {
      if (outcome !== "ok") say(outcome, detail);
      try {
        await recordAiLedger(db, {
          accountId: input.accountId, feature: input.feature, model: input.model.slice(0, 64),
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicroUsd: usage.costMicroUsd,
          outcome, latencyMs: Date.now() - started, ...keys, signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
        });
      } catch (e) {
        // Never retried (see above). A database error message carries no prompt.
        console.error(`ai: ledger write failed for account ${input.accountId} feature ${input.feature} outcome ${outcome}: ${loggableError(e)}`);
      }
    };

    const model = input.model;
    if (!isPricedModel(model)) {
      await finish("unknown_model", NO_USAGE);
      return { ok: false, reason: "unknown_model" };
    }
    let gate: AiGate;
    try {
      gate = await aiGateCheck(db, { accountId: input.accountId, ...keys, signal: AbortSignal.timeout(GATE_TIMEOUT_MS) });
    } catch (e) {
      // A database error message carries no prompt; loggableError keeps it readable.
      await finish("gate_unreadable", NO_USAGE, `: ${loggableError(e)}`);
      return { ok: false, reason: "gate_unreadable" };
    }
    const closed: AiRefusal | null = !gate.globalEnabled ? "global_off"
      : !gate.accountEnabled ? "account_off"
      : gate.monthSpendMicroUsd >= gate.budgetMicroUsd ? "over_budget"
      : null;
    if (closed) {
      await finish(closed, NO_USAGE);
      return { ok: false, reason: closed };
    }

    const answer = await providerFor(process.env).complete({
      model, messages: input.messages, responseFormat: input.responseFormat, maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs, language: input.language, fetchImpl: input.fetchImpl,
    });
    if (answer.kind === "no_key" || answer.kind === "timeout") {
      await finish(answer.kind, NO_USAGE);
      return { ok: false, reason: answer.kind };
    }
    const priced = (p: number | null, c: number | null, text: string): AiUsage => {
      const promptChars = input.messages.reduce((n, msg) => n + msg.content.length, 0);
      return {
        inputTokens: p, outputTokens: c,
        costMicroUsd: costMicroUsd(model, p ?? estimatedTokens(promptChars), c ?? estimatedTokens(text.length)),
      };
    };
    if (answer.kind === "provider_error") {
      const reported = answer.promptTokens !== null || answer.completionTokens !== null;
      await finish("provider_error", reported ? priced(answer.promptTokens, answer.completionTokens, "") : NO_USAGE, answer.detail);
      return { ok: false, reason: "provider_error" };
    }
    const usage = priced(answer.promptTokens, answer.completionTokens, answer.text);
    await finish("ok", usage);
    return { ok: true, text: answer.text, usage };
  } catch (e) {
    // Only the class: an unexpected error here may have come from the provider path.
    console.error(`${who}: unexpected ${e instanceof Error ? e.name : typeof e}`);
    return { ok: false, reason: "provider_error" };
  }
}
