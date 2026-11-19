// apps/web/src/lib/ai/tool-turn.ts
// The shared chat tool turn (F-023 plan §3.4): the web chat's D-047 loop, made general. One completion with the
// offered tools; if the model calls one, run it, DISCARD every word the model wrote beside the call (written before
// anything happened, so it can claim what did not), and ask a second completion that hears the real result and may
// not call a tool again. The caller keeps its handler and its fallback lines.
//
// Imports the gateway at module scope, and the gateway imports `@bis/db`: a route that loads `@bis/db` lazily loads
// this lazily too.
import type { SupabaseClient } from "@bis/db";
import { aiComplete, aiOverheadMs, type AiInput, type AiMessage, type AiTool, type AiToolCall } from "./gateway";
import { runOffered } from "@/lib/tools/belt";

export type ToolTurnBudget = {
  /** Date.now() when the whole request began. */
  startedAt: number;
  /** What the whole invocation may spend, startedAt included. */
  totalMs: number;
  /** The second completion's own cap, and the least time worth starting it with. */
  followupMaxMs: number;
  followupMinMs: number;
};

export type ToolTurn<R> = {
  /** The reply's words, raw. With a tool call this is ONLY the second completion's, "" when it was skipped or failed. */
  text: string;
  toolCalled: boolean;
  /** What the handler (or the refusal) answered, when a tool was called. */
  toolResult?: R;
  /** How the second completion went; absent when no tool was called. `timeLeft` and `error` are for the caller's log. */
  followup?: "answered" | "skipped" | "failed";
  timeLeft?: number;
  error?: unknown;
};

export async function completeWithTool<R>(o: {
  db: SupabaseClient;
  input: Omit<AiInput, "tools" | "toolChoice" | "timeoutMs">;
  /** The chat shapes (belt.ts chatShape) this turn offers; their names are the catalogue AND the offered list. */
  tools: readonly AiTool[];
  firstTimeoutMs: number;
  budget: ToolTurnBudget;
  /** Runs the tool. `raw` is the model's argument text exactly as sent; `args` its parse (an object, else `{}`). */
  run: (name: string, args: Record<string, unknown>, raw: string) => Promise<R>;
  /** A name this turn does not offer: nothing runs, this is the tool's answer. */
  refused: (name: string) => R;
  /** `run` threw: only its class reaches here, never its message. */
  failed: (errorClass: string) => R;
}): Promise<ToolTurn<R>> {
  const names = o.tools.map((t) => t.function.name);
  const complete = async (messages: AiMessage[], timeoutMs: number, toolChoice?: "none") => {
    const answer = await aiComplete(o.db, {
      ...o.input, messages, tools: [...o.tools], ...(toolChoice ? { toolChoice } : {}), timeoutMs,
    });
    if (!answer.ok) throw new Error(`ai ${answer.reason}`);
    return answer;
  };

  // A failure here propagates: the caller decides what an unanswered turn costs.
  const first = await complete(o.input.messages, o.firstTimeoutMs);
  // ONE call per turn (D-047's rule): the first of an offered tool, else the first call at all. A call whose
  // arguments are empty is no call, as before: the model's own words stand.
  const calls = (first.toolCalls ?? []).filter((c): c is AiToolCall & { arguments: string } => !!c.arguments);
  const call = calls.find((c) => names.includes(c.name)) ?? calls[0];
  if (!call) return { text: first.text, toolCalled: false };

  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch { /* the handler reads `raw` and decides what unusable arguments mean */ }
  const toolResult = await runOffered<string, R>({
    catalogue: names, offered: names, name: call.name, args,
    run: (name, a) => o.run(name, a, call.arguments),
    notOffered: o.refused, unknown: () => o.refused(call.name), onError: o.failed,
  });

  // Bounded by what is left of this invocation, less the gateway's own overhead for the call (aiOverheadMs). Too
  // little left, or the call fails: no second reply, never the pre-result words.
  const timeLeft = o.budget.totalMs - (Date.now() - o.budget.startedAt) - aiOverheadMs(o.input.task);
  const timeoutMs = Math.min(o.budget.followupMaxMs, timeLeft);
  if (timeoutMs < o.budget.followupMinMs) return { text: "", toolCalled: true, toolResult, followup: "skipped", timeLeft };
  try {
    const second = await complete([
      ...o.input.messages,
      { role: "assistant", content: null, toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }] },
      { role: "tool", toolCallId: call.id, content: JSON.stringify(toolResult) },
    ], timeoutMs, "none");
    return { text: second.text, toolCalled: true, toolResult, followup: "answered", timeLeft };
  } catch (error) {
    return { text: "", toolCalled: true, toolResult, followup: "failed", timeLeft, error };
  }
}

