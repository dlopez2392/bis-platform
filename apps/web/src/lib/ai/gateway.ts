import { AI_OUTCOMES, aiGateCheck, recordAiLedger, type AiGate, type AiOutcome, type SupabaseClient } from "@bis/db";
import { safeZone } from "@/lib/billing/billing-view";
import { loggableError } from "@/lib/loggable-error";
import { costMicroUsd, estimatedTokens, isPricedModel } from "./prices";
import { periodKeys } from "./period";
import { providerFor } from "./providers/select";
import { AI_TASKS, type AiTask, type ModelRoute } from "./tasks";

/**
 * ONE DOOR for every model completion (item 8a-1, spec 3.1). Never throws: it answers the text, or a reason.
 * Every caller already has a non-AI form and maps every reason to it. The caller names its TASK; the task's row
 * (tasks.ts) names the model, its request settings, its fallback and its ledger feature. No caller names a model.
 *
 * Order: (1) AI_GATEWAY_OFF=1, no database read, no ledger row; (2) the model must be priced; (3) one gate read,
 * bounded at 3 s, failing CLOSED (choice I9); (4) the global switch, the account's, the budget (spend >= budget);
 * (5) the provider (the key is checked here), under the caller's time limit; (6) one ledger row, bounded at 3 s,
 * whose failure is logged and keeps the text (the call is already paid for). Steps 2-5's refusals write a
 * zero-cost row (choice I10). The ledger write is NEVER retried: a failed or timed-out write may still have
 * committed (recordAiLedger's own contract), and a retry could count the cost twice.
 *
 * (7) The fallback, when the task has one: tried ONCE, only after a provider error the provider marked transient
 * (never after a refusal in 1-4, a missing key, a timeout, or a 4xx that says the request was wrong), and only
 * with at least FALLBACK_MIN_MS left of the caller's time limit, which the two attempts share. Each attempt writes
 * its own ledger row under its own model, so the cost is recorded against the model actually used.
 *
 * A task whose `feature` is null (the web chat, until a migration admits it to ai_ledger) skips steps 3-4 and
 * writes no ledger row: it honours the kill switch (step 1) and nothing else here. The AI settings copy promises
 * operators that the account switch, the global switch and the budget leave the website chat running; those
 * gates join the chat with the ledger migration and a copy rewrite, the owner's call (review of #362).
 *
 * The month and day keys are the account-zone date of `input.now ?? new Date()`, the real clock: 0086 accepts
 * any well-formed key and relies on the app never sending a far-future one.
 *
 * The client is the CALLER's: finishCall passes its service client (the two RPCs are service_role only). This
 * file never names a service-client getter (in-account-service-reads.test.ts scans lib/).
 *
 * Logged: the task, the account id, the caller's id-only `ref`, the outcome, an HTTP status or an error's
 * class, and the latency. NEVER a message, a prompt, an answer, or an error message from the provider path.
 * Only non-ok outcomes log; the three expected states (switched off, over budget) on console.log so they never
 * read as alerts. Budget overshoot is bounded, not zero: concurrent calls that all passed the gate before any
 * recorded can overshoot by their own cost (spec 3.1). A TIMED-OUT request is recorded at zero cost, but the
 * provider may still have run it and may bill it: the ledger's estimate can undercount by those calls (review M11).
 */
export type AiToolCall = { id: string; name: string; arguments: string | null };
export type AiTextMessage = { role: "system" | "user"; content: string };
export type AiMessage =
  | AiTextMessage
  | { role: "assistant"; content: string | null; toolCalls?: AiToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };
/** A function tool in the shape the web chat declares it (concierge/prompt.ts's CAPTURE_LEAD_TOOL). */
export type AiTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type AiRefusal = Exclude<AiOutcome, "ok">;
export const AI_REFUSALS: readonly AiRefusal[] = AI_OUTCOMES.filter((o): o is AiRefusal => o !== "ok");
export type AiUsage = { inputTokens: number | null; outputTokens: number | null; costMicroUsd: number };
/** `model` is the model that answered (the fallback's, when it did). `toolCalls` only when tools were offered. */
export type AiResult =
  | { ok: true; text: string; model: string; toolCalls?: AiToolCall[]; usage: AiUsage }
  | { ok: false; reason: AiRefusal };
export type AiInput = {
  accountId: string;
  task: AiTask;
  messages: AiMessage[];
  /** Function tools the model may call, and `toolChoice: "none"` when it may not call one now. */
  tools?: AiTool[];
  toolChoice?: "none";
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
/** Below this much of the caller's time limit, a fallback is not started: it could only time out. */
export const FALLBACK_MIN_MS = 1_000;
const NO_USAGE: AiUsage = { inputTokens: null, outputTokens: null, costMicroUsd: 0 };
const QUIET: ReadonlySet<AiOutcome> = new Set<AiOutcome>(["global_off", "account_off", "over_budget"]);

/**
 * How long the gateway may spend on the gate read (steps 3-4) before a task's completion: GATE_TIMEOUT_MS, or 0
 * for a task with no ledger feature, which skips the gate (see aiComplete). A caller that budgets its own time
 * around a completion (the web chat's follow-up) subtracts this.
 */
export function aiGateMs(task: AiTask): number {
  return AI_TASKS[task].feature === null ? 0 : GATE_TIMEOUT_MS;
}

/**
 * What a caller that spends something of its OWN before its completion (the web chat claims a visitor's turn)
 * checks first: the kill switch, and whether the provider is configured at all. Reads no database and writes
 * nothing. null = go ahead; aiComplete still makes every check itself.
 */
export function aiReadiness(): "global_off" | "no_key" | null {
  if (process.env.AI_GATEWAY_OFF === "1") return "global_off";
  return providerFor(process.env).configured() ? null : "no_key";
}

export async function aiComplete(db: SupabaseClient, input: AiInput): Promise<AiResult> {
  const started = Date.now();
  const who = `ai: ${input.task} for account ${input.accountId}${input.ref ? ` (${input.ref})` : ""}`;
  const say = (outcome: AiOutcome, detail = "") => {
    const line = `${who}: ${outcome}${detail} after ${Date.now() - started} ms`;
    if (QUIET.has(outcome)) console.log(line); else console.error(line);
  };
  try {
    if (process.env.AI_GATEWAY_OFF === "1") {
      say("global_off", " (AI_GATEWAY_OFF)");
      return { ok: false, reason: "global_off" };
    }
    const route = AI_TASKS[input.task];
    const keys = periodKeys(input.now ?? new Date(), safeZone(input.timezone));
    const finish = async (outcome: AiOutcome, usage: AiUsage, model: string, detail = ""): Promise<void> => {
      if (outcome !== "ok") say(outcome, detail);
      if (route.feature === null) return;
      try {
        await recordAiLedger(db, {
          accountId: input.accountId, feature: route.feature, model: model.slice(0, 64),
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicroUsd: usage.costMicroUsd,
          outcome, latencyMs: Date.now() - started, ...keys, signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
        });
      } catch (e) {
        // Never retried (see above). A database error message carries no prompt.
        console.error(`ai: ledger write failed for account ${input.accountId} feature ${route.feature} outcome ${outcome}: ${loggableError(e)}`);
      }
    };

    const primary: ModelRoute = route.primary;
    if (!isPricedModel(primary.model)) {
      await finish("unknown_model", NO_USAGE, primary.model);
      return { ok: false, reason: "unknown_model" };
    }
    if (aiGateMs(input.task) > 0) {
      let gate: AiGate;
      try {
        gate = await aiGateCheck(db, { accountId: input.accountId, ...keys, signal: AbortSignal.timeout(GATE_TIMEOUT_MS) });
      } catch (e) {
        // A database error message carries no prompt; loggableError keeps it readable.
        await finish("gate_unreadable", NO_USAGE, primary.model, `: ${loggableError(e)}`);
        return { ok: false, reason: "gate_unreadable" };
      }
      const closed: AiRefusal | null = !gate.globalEnabled ? "global_off"
        : !gate.accountEnabled ? "account_off"
        : gate.monthSpendMicroUsd >= gate.budgetMicroUsd ? "over_budget"
        : null;
      if (closed) {
        await finish(closed, NO_USAGE, primary.model);
        return { ok: false, reason: closed };
      }
    }

    const provider = providerFor(process.env);
    const promptChars = input.messages.reduce((n, msg) => n + (msg.content ?? "").length, 0);
    /** One request to one model; its own ledger row. `transient`: a fallback may follow it. */
    const attempt = async (r: ModelRoute, timeoutMs: number, note: string): Promise<{ result: AiResult; transient: boolean }> => {
      const answer = await provider.complete({
        model: r.model, params: r.params, messages: input.messages, tools: input.tools, toolChoice: input.toolChoice,
        timeoutMs, language: input.language, fetchImpl: input.fetchImpl,
      });
      if (answer.kind === "no_key" || answer.kind === "timeout") {
        await finish(answer.kind, NO_USAGE, r.model, note);
        return { result: { ok: false, reason: answer.kind }, transient: false };
      }
      const priced = (p: number | null, c: number | null, text: string): AiUsage => ({
        inputTokens: p, outputTokens: c,
        costMicroUsd: costMicroUsd(r.model, p ?? estimatedTokens(promptChars), c ?? estimatedTokens(text.length)),
      });
      if (answer.kind === "provider_error") {
        const reported = answer.promptTokens !== null || answer.completionTokens !== null;
        await finish("provider_error", reported ? priced(answer.promptTokens, answer.completionTokens, "") : NO_USAGE, r.model, `${answer.detail}${note}`);
        return { result: { ok: false, reason: "provider_error" }, transient: answer.transient };
      }
      const usage = priced(answer.promptTokens, answer.completionTokens, answer.text);
      await finish("ok", usage, r.model);
      return {
        result: { ok: true, text: answer.text, model: r.model, ...(answer.toolCalls ? { toolCalls: answer.toolCalls } : {}), usage },
        transient: false,
      };
    };

    const providerStarted = Date.now();
    const first = await attempt(primary, input.timeoutMs, "");
    const fallback = route.fallback;
    if (first.result.ok || !first.transient || !fallback) return first.result;
    const left = input.timeoutMs - (Date.now() - providerStarted);
    if (left < FALLBACK_MIN_MS) return first.result;
    const note = ` (fallback after ${primary.model})`;
    if (!isPricedModel(fallback.model)) {
      await finish("unknown_model", NO_USAGE, fallback.model, note);
      return first.result;
    }
    return (await attempt(fallback, left, note)).result;
  } catch (e) {
    // Only the class: an unexpected error here may have come from the provider path.
    console.error(`${who}: unexpected ${e instanceof Error ? e.name : typeof e}`);
    return { ok: false, reason: "provider_error" };
  }
}
