// The OpenAI model switch's Step 0 (a) (docs/superpowers/plans/2026-11-26-openai-model-switch.md, section 4):
// what gpt-6-luna accepts for each of the five text tasks in src/lib/ai/tasks.ts. Pure apart from the fetch it
// is handed, so apps/web/ci/model-spike.test.ts drives it against a fake OpenAI.
//
// Its markdown goes to a PUBLIC log and job summary (sofia-corpus.yml, step=model-spike). So it prints statuses,
// an error's code, type and param (realtimeErrorWhy, never its message), finish reasons and token counts as
// identifier characters, and yes/no facts about an answer. Never the key, a header, an answer's words or an
// error's body. Every input is synthetic: no customer, call or record is read.
import { AI_TASKS, AI_TASK_NAMES, type AiTask, type ModelParams } from "../src/lib/ai/tasks";
import { modelBodyFields } from "../src/lib/ai/providers/openai";
import { CAPTURE_LEAD_TOOL, budgetNotice } from "../src/lib/concierge/prompt";
import { CONCIERGE_MAX_TURNS } from "../src/lib/concierge/guards";
import { buildSystemPrompt } from "../src/lib/voice/system-prompt";
import { summaryMessages } from "../src/lib/record/ai-summary-prompt";
import { realtimeErrorWhy } from "./realtime-spike-why";

export const SPIKE_MODEL = "gpt-6-luna";
const BASE = "https://api.openai.com/v1";
const RUNS = 5;
/** Per call. Three of the callers allow 10 s; this still records a slower answer as a number, not a timeout. */
const CALL_TIMEOUT_MS = 30_000;
/**
 * No call STARTS after this. At most 135 completions plus the models list can run (27 variants, 5 runs each), and
 * at 30 s each they would outlast the job's 60 minutes; this, not the count, bounds the run.
 */
const DEADLINE_MS = 45 * 60_000;
const MODEL_PREFIXES = ["gpt-6", "gpt-realtime", "gpt-transcribe", "gpt-live"];
const EFFORTS = ["none", "minimal", "low"] as const;

type Api = "chat" | "responses";
type Shape = "plain" | "first_turn" | "followup";
type Variant = { name: string; api: Api; shape: Shape; params: ModelParams };
type Msg = Record<string, unknown>;
export type CallRecord = {
  status: string; why: string; finish: string;
  prompt: number | null; completion: number | null; reasoning: number | null; ms: number;
  empty: boolean | null; json: boolean | null; tool: boolean | null;
};
type VariantResult = { task: AiTask; variant: Variant; calls: CallRecord[] };

const token = (v: unknown) => (typeof v === "string" ? v.replace(/[^\w.[\]-]/g, "").slice(0, 80) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const errorClass = (e: unknown) => token(typeof e === "object" && e !== null ? (e as { name?: unknown }).name : "") || "Error";

// ---- Synthetic messages, each shaped like the real call site's (the file named beside it). ----
const TRANSCRIPT = [
  "assistant: Thanks for calling Spike Test Co, this is Sofía, an AI assistant. How can I help?",
  "user: Hi, my kitchen faucet is leaking under the sink and I'd like someone to come look at it this week.",
  "assistant: I can take a message for the team. What is your name and the best number to reach you?",
  "user: It's Pat Example, 956-555-0142. Mornings are best.",
  "assistant: Thank you, Pat. I'll pass that on and someone will call you back.",
].join("\n");

const PROMPT_INPUT = {
  personaName: "Sofía", businessName: "Spike Test Co", facts: "- Open 9 to 5, Monday to Friday.",
  services: "Plumbing repairs", languages: "both", bookingEnabled: false, timezone: "America/Chicago",
  slotDurationMinutes: 30, afterHours: "hours_then_message", callerNumber: null, meetingType: "in_person",
} as const;

/** The website chat's turn (api/concierge/[publicId]/turn): the web prompt plus the budget notice, then the visitor. */
function webChatMessages(now: Date): Msg[] {
  return [
    { role: "system", content: buildSystemPrompt({ ...PROMPT_INPUT, medium: "web" }, now) + budgetNotice(CONCIERGE_MAX_TURNS) },
    { role: "user", content: "Hi, my faucet is leaking. I'm Pat Example, 956-555-0142, please have someone call me." },
  ];
}
const CAPTURE_ARGS = JSON.stringify({ fullName: "Pat Example", phone: "956-555-0142", email: "", need: "Leaking faucet" });
const CAPTURE_RESULT = JSON.stringify({ ok: true, message: "Saved. The team will reach out." });

function taskMessages(task: Exclude<AiTask, "web_chat">, now: Date): Msg[] {
  switch (task) {
    case "call_summary": // voice/summary-service.ts
      return [
        { role: "system", content: "Summarize this front-desk call for staff in 3-4 sentences. The BOOKED and INTAKE sections are the system's own records and are authoritative. Never invent names, phone numbers, email addresses or times that do not appear in the input. Always write the summary in English. State all dates and times in the America/Chicago timezone." },
        { role: "user", content: `BOOKED: (none)\nINTAKE: name Pat Example, phone +19565550142\nTRANSCRIPT:\n${TRANSCRIPT}` },
      ];
    case "call_card": // voice/call-card.ts
      return [
        { role: "system", content: 'You read a finished phone call to a small business and fill in a card the owner reads in three seconds. Reply ONLY with JSON: {"reason": "...", "quote": "..."}. reason: why the caller called, at most 12 words, the way an owner jots it on a sticky note. quote: the caller\'s OWN words, copied VERBATIM from ONE caller line. If there is no such line, quote is null.' },
        { role: "user", content: TRANSCRIPT },
      ];
    case "call_proposals": // proposals/generate.ts
      return [
        { role: "system", content: `You read a finished phone call and propose at most three concrete next steps. Every proposal MUST carry an \`evidence\` field quoting the CALLER's own words VERBATIM. \`dueAt\` MUST be a full ISO-8601 instant or null. Reply ONLY with JSON: {"proposals":[{"kind":"task","title":"...","dueAt":null,"evidence":"..."}]} If there is nothing to propose, reply {"proposals":[]}. This call happened at ${now.toISOString()}, in the account's own time zone (America/Chicago).` },
        { role: "user", content: TRANSCRIPT },
      ];
    case "record_summary": // record/ai-summary-prompt.ts, the real builder
      return summaryMessages({
        who: { firstName: "Pat", language: "en", since: "2026-10-01", source: "call" },
        facts: { bookingsMade: 1, lastTalked: { channel: "call", on: "2026-11-20" }, openDeals: { count: 0, amount: null } },
        bookings: [{ at: "2026-11-24 09:00", status: "confirmed" }],
        nextBooking: { at: "2026-11-24 09:00", status: "confirmed" },
        deals: [], todos: [{ title: "Call Pat back about the faucet", due: null }], documents: [],
        calls: [{ on: "2026-11-20", outcome: "message", summary: "Pat called about a leaking kitchen faucet and asked for a callback." }],
      }, "en");
  }
}

// ---- Variants and bodies. ----
/** V1 today's row; V2 the cap under max_completion_tokens (skipped when the row sends no cap); V3 V2 plus each effort. */
export function variantsFor(task: AiTask): Variant[] {
  const v1 = AI_TASKS[task].primary.params;
  const v2: ModelParams = v1.maxOutput ? { ...v1, maxOutput: { field: "max_completion_tokens", tokens: v1.maxOutput.tokens } } : v1;
  const shape: Shape = task === "web_chat" ? "first_turn" : "plain";
  return [
    { name: "V1", api: "chat", shape, params: v1 },
    ...(v1.maxOutput ? [{ name: "V2", api: "chat" as const, shape, params: v2 }] : []),
    ...EFFORTS.map((e) => ({ name: `V3 ${e}`, api: "chat" as const, shape, params: { ...v2, reasoningEffort: e } })),
  ];
}

function chatBody(task: AiTask, v: Variant, now: Date): Msg {
  const messages = task === "web_chat" ? webChatMessages(now) : taskMessages(task, now);
  if (v.shape === "followup") {
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: "call_spike_1", type: "function", function: { name: "capture_lead", arguments: CAPTURE_ARGS } }] });
    messages.push({ role: "tool", tool_call_id: "call_spike_1", content: CAPTURE_RESULT });
  }
  return {
    model: SPIKE_MODEL, messages,
    ...(v.params.responseFormat ? { response_format: v.params.responseFormat } : {}),
    ...(v.shape !== "plain" ? { tools: [CAPTURE_LEAD_TOOL] } : {}),
    ...modelBodyFields(v.params),
    ...(v.shape === "followup" ? { tool_choice: "none" } : {}),
  };
}

/** The web chat on POST /v1/responses: flat tools, max_output_tokens, reasoning.effort, nothing stored. */
function responsesBody(v: Variant, now: Date): Msg {
  const input: Msg[] = webChatMessages(now);
  if (v.shape === "followup") {
    input.push({ type: "function_call", call_id: "call_spike_1", name: "capture_lead", arguments: CAPTURE_ARGS });
    input.push({ type: "function_call_output", call_id: "call_spike_1", output: CAPTURE_RESULT });
  }
  const { name, description, parameters } = CAPTURE_LEAD_TOOL.function;
  return {
    model: SPIKE_MODEL, input, store: false,
    tools: [{ type: "function", name, description, parameters }],
    ...(v.params.maxOutput ? { max_output_tokens: v.params.maxOutput.tokens } : {}),
    ...(v.params.reasoningEffort ? { reasoning: { effort: v.params.reasoningEffort } } : {}),
    ...(v.shape === "followup" ? { tool_choice: "none" } : {}),
  };
}

// ---- One call, read without printing a word of it. ----
type ChatAnswer = { choices?: { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } } };
type ResponsesAnswer = { status?: unknown; incomplete_details?: { reason?: unknown }; output?: { type?: unknown; content?: { type?: unknown; text?: unknown }[] }[]; usage?: { input_tokens?: unknown; output_tokens?: unknown; output_tokens_details?: { reasoning_tokens?: unknown } } };

/** One run's settings and progress. `clock` is milliseconds; `calls` counts the completions started. */
type Run = { fetchImpl: typeof fetch; key: string; now: Date; callTimeoutMs: number; clock: () => number; started: number; deadlineMs: number; calls: number; stopped: boolean };

const isTimeout = (e: unknown) => ["TimeoutError", "AbortError"].includes(errorClass(e));
function parsesAsObject(text: string): boolean {
  try { const v: unknown = JSON.parse(text); return typeof v === "object" && v !== null; } catch { return false; }
}

async function callOnce(run: Run, task: AiTask, v: Variant): Promise<CallRecord> {
  const blank = { finish: "-", prompt: null, completion: null, reasoning: null, empty: null, json: null, tool: null };
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const timedOut = (): CallRecord => ({ ...blank, status: "timeout", why: "-", ms: ms() });
  run.calls += 1;
  let r: Response;
  try {
    r = await run.fetchImpl(`${BASE}/${v.api === "chat" ? "chat/completions" : "responses"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${run.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(v.api === "chat" ? chatBody(task, v, run.now) : responsesBody(v, run.now)),
      signal: AbortSignal.timeout(run.callTimeoutMs),
    });
  } catch (e) {
    return isTimeout(e) ? timedOut() : { ...blank, status: "network", why: errorClass(e), ms: ms() };
  }
  let data: unknown = null;
  try { data = await r.json(); } catch (e) { if (isTimeout(e)) return timedOut(); /* otherwise "did not parse", below */ }
  if (!r.ok) return { ...blank, status: String(r.status), why: realtimeErrorWhy((data as { error?: unknown } | null)?.error), ms: ms() };
  if (data === null || typeof data !== "object") return { ...blank, status: String(r.status), why: "an answer that did not parse", ms: ms() };
  const isJson = AI_TASKS[task].primary.params.responseFormat ? true : null;
  if (v.api === "chat") {
    const d = data as ChatAnswer;
    const c = d.choices?.[0];
    const text = typeof c?.message?.content === "string" ? c.message.content : "";
    return {
      status: String(r.status), why: "-", finish: token(c?.finish_reason) || "-", ms: ms(),
      prompt: int(d.usage?.prompt_tokens), completion: int(d.usage?.completion_tokens), reasoning: int(d.usage?.completion_tokens_details?.reasoning_tokens),
      empty: text.trim() === "", json: isJson && parsesAsObject(text), tool: v.shape === "plain" ? null : Array.isArray(c?.message?.tool_calls) && c.message.tool_calls.length > 0,
    };
  }
  const d = data as ResponsesAnswer;
  const out = Array.isArray(d.output) ? d.output : [];
  const text = out.filter((o) => o?.type === "message").flatMap((o) => (Array.isArray(o.content) ? o.content : []))
    .map((c) => (c?.type === "output_text" && typeof c.text === "string" ? c.text : "")).join("");
  const why = token(d.incomplete_details?.reason);
  return {
    status: String(r.status), why: why ? `incomplete: ${why}` : "-", finish: token(d.status) || "-", ms: ms(),
    prompt: int(d.usage?.input_tokens), completion: int(d.usage?.output_tokens), reasoning: int(d.usage?.output_tokens_details?.reasoning_tokens),
    empty: text.trim() === "", json: null, tool: out.some((o) => o?.type === "function_call"),
  };
}

/** True, and the run marked stopped, once the deadline has passed: no call starts after it. */
function pastDeadline(run: Run): boolean {
  if (!run.stopped && run.clock() - run.started >= run.deadlineMs) run.stopped = true;
  return run.stopped;
}

/** One call; when it was accepted (2xx), four more. Null when the deadline stopped it before its first call. */
async function runVariant(run: Run, task: AiTask, v: Variant): Promise<VariantResult | null> {
  if (pastDeadline(run)) return null;
  const calls = [await callOnce(run, task, v)];
  if (/^2\d\d$/.test(calls[0]!.status)) {
    for (let i = 1; i < RUNS && !pastDeadline(run); i += 1) calls.push(await callOnce(run, task, v));
  }
  return { task, variant: v, calls };
}

async function listModels(run: Run): Promise<{ status: string; why: string; ids: string[] }> {
  try {
    const r = await run.fetchImpl(`${BASE}/models`, { headers: { Authorization: `Bearer ${run.key}` }, signal: AbortSignal.timeout(run.callTimeoutMs) });
    const data = await r.json().catch(() => null) as { data?: { id?: unknown }[]; error?: unknown } | null;
    if (!r.ok) return { status: String(r.status), why: realtimeErrorWhy(data?.error), ids: [] };
    const ids = (Array.isArray(data?.data) ? data.data : []).map((m) => m?.id)
      .filter((id): id is string => typeof id === "string" && /^[\w.-]{1,80}$/.test(id) && MODEL_PREFIXES.some((p) => id.startsWith(p)));
    return { status: String(r.status), why: "-", ids: [...new Set(ids)].sort() };
  } catch (e) {
    return isTimeout(e) ? { status: "timeout", why: "-", ids: [] } : { status: "network", why: errorClass(e), ids: [] };
  }
}

// ---- The summary, emitted a section at a time so a killed job still leaves what it measured. ----
const yn = (b: boolean | null) => (b === null ? "-" : b ? "y" : "n");
const num = (n: number | null) => (n === null ? "-" : String(n));
const accepted = (r: VariantResult) => /^2\d\d$/.test(r.calls[0]!.status);

function modelsSection(models: Awaited<ReturnType<typeof listModels>>): string {
  return ["## Models this key can see", "",
    `GET /v1/models: ${models.status}${models.why === "-" ? "" : ` (${models.why})`}, filtered to ${MODEL_PREFIXES.map((p) => `${p}*`).join(", ")}.`, "",
    ...(models.ids.length ? models.ids.map((id) => `- ${id}`) : ["- (none)"]), ""].join("\n");
}

function taskSection(task: AiTask, results: VariantResult[], notes: string[]): string {
  const lines = [`## ${task}`, "", ...notes.map((n) => `- ${n}`), ...(notes.length ? [""] : []),
    "| task | variant | api | accepted | runs | non-empty | JSON parses | tool call | finish | slowest ms | most reasoning tokens |",
    "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of results) {
    const c = r.calls;
    const count = (f: (x: CallRecord) => boolean | null) => `${c.filter((x) => f(x) === true).length}/${c.length}`;
    const finishes = [...new Set(c.map((x) => x.finish))].join(" ");
    const most = Math.max(...c.map((x) => x.reasoning ?? -1));
    lines.push(`| ${r.task} | ${r.variant.name} | ${r.variant.api} | ${accepted(r) ? "y" : "n"} | ${c.length} | ${count((x) => x.empty === null ? null : !x.empty)} | ${c[0]!.json === null ? "-" : count((x) => x.json)} | ${c[0]!.tool === null ? "-" : count((x) => x.tool)} | ${finishes} | ${Math.max(...c.map((x) => x.ms))} | ${most < 0 ? "-" : most} |`);
  }
  lines.push("", "| task | variant | api | run | status | why | finish | prompt | completion | reasoning | ms | empty | JSON parses | tool call |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    r.calls.forEach((x, i) => lines.push(`| ${r.task} | ${r.variant.name} | ${r.variant.api} | ${i + 1} | ${x.status} | ${x.why} | ${x.finish} | ${num(x.prompt)} | ${num(x.completion)} | ${num(x.reasoning)} | ${x.ms} | ${yn(x.empty)} | ${yn(x.json)} | ${yn(x.tool)} |`));
  }
  return [...lines, ""].join("\n");
}

export type SpikeOptions = {
  /** Called with each section as soon as it is measured; the script prints it at once. */
  emit?: (chunk: string) => void;
  now?: Date; callTimeoutMs?: number; deadlineMs?: number; clock?: () => number;
};

/** The whole spike. `everyTaskAccepted`: every task had at least one accepted variant, on either API. */
export async function runModelSpike(fetchImpl: typeof fetch, key: string, opts: SpikeOptions = {}): Promise<{ markdown: string; everyTaskAccepted: boolean }> {
  const clock = opts.clock ?? Date.now;
  const run: Run = {
    fetchImpl, key, now: opts.now ?? new Date(), callTimeoutMs: opts.callTimeoutMs ?? CALL_TIMEOUT_MS, clock,
    started: clock(), deadlineMs: opts.deadlineMs ?? DEADLINE_MS, calls: 0, stopped: false,
  };
  const chunks: string[] = [];
  const emit = (chunk: string) => { chunks.push(chunk); opts.emit?.(chunk); };
  emit([`# Model spike: ${SPIKE_MODEL}`, "",
    "Synthetic messages shaped like each task's real one. An accepted variant ran 5 times, a refused one once.", ""].join("\n"));
  emit(modelsSection(await listModels(run)));
  const results: VariantResult[] = [];
  for (const task of AI_TASK_NAMES) {
    const notes: string[] = [];
    if (!AI_TASKS[task].primary.params.maxOutput) notes.push(`${task} sends no cap today, so V2 is V1 and is not sent; V3 is V1 plus each effort.`);
    const mine: VariantResult[] = [];
    const add = (r: VariantResult | null) => { if (r) mine.push(r); };
    for (const v of variantsFor(task)) add(await runVariant(run, task, v));
    if (task === "web_chat" && !run.stopped) {
      // The follow-up and Responses runs carry the first params Chat Completions accepted, else V1's.
      const params = mine.find(accepted)?.variant.params ?? AI_TASKS.web_chat.primary.params;
      notes.push(`web_chat's follow-up and Responses runs use ${mine.find(accepted)?.variant.name ?? "V1 (no Chat Completions variant was accepted)"}'s params.`);
      for (const v of [
        { name: "chat follow-up", api: "chat", shape: "followup", params },
        { name: "responses first turn", api: "responses", shape: "first_turn", params },
        { name: "responses follow-up", api: "responses", shape: "followup", params },
      ] as const) add(await runVariant(run, task, v));
    }
    if (mine.length) emit(taskSection(task, mine, notes));
    results.push(...mine);
    if (run.stopped) break;
  }
  if (run.stopped) emit(`Stopped early at ${run.calls} calls: the ${Math.round(run.deadlineMs / 60_000)}-minute deadline.\n`);
  const everyTaskAccepted = AI_TASK_NAMES.every((t) => results.some((r) => r.task === t && accepted(r)));
  return { markdown: chunks.join("\n"), everyTaskAccepted };
}
