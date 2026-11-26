import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runModelSpike, SPIKE_MODEL } from "../scripts/model-spike-lib";

// apps/web/scripts/model-spike.ts (OpenAI model switch plan, Step 0 (a)) runs in sofia-corpus.yml, whose log
// and job summary are PUBLIC. It may print statuses, error codes, token counts and yes/no facts about an
// answer, never the key, an error's free-text message or a model's words. These cases drive the real spike
// against a fake fetch whose every free-text path carries a sentinel; nothing here touches the network.

const SPIKE = fileURLToPath(new URL("../scripts/model-spike.ts", import.meta.url));
const WEB = fileURLToPath(new URL("..", import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const SENTINEL = "SENTINEL-do-not-print";
const KEY = "sk-test-KEY-do-not-print";

vi.setConfig({ testTimeout: 60_000 });

type Sent = { url: string; method: string; auth: string | null; body: Record<string, unknown> | null };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (param: string) => json(400, {
  error: { message: `${SENTINEL} you sent ${param}`, type: "invalid_request_error", param, code: "unsupported_parameter" },
});

/**
 * A fake OpenAI that refuses `max_tokens` and `reasoning_effort: "none"` on Chat Completions and accepts the
 * rest. Every answer's words are the sentinel, so a printed answer shows up.
 */
function fakeOpenAi(overrides: { chat?: (body: Record<string, unknown>) => Response | Promise<Response> } = {}) {
  const sent: Sent[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    sent.push({ url, method: init?.method ?? "GET", auth: headers.get("Authorization"), body });
    if (url.endsWith("/v1/models")) {
      return json(200, { data: [
        { id: "gpt-6-luna" }, { id: "gpt-4o-mini" }, { id: "gpt-realtime-2.1" }, { id: "gpt-transcribe" },
        { id: "gpt-live-transcribe" }, { id: "whisper-1" }, { id: `gpt-6-${SENTINEL} with spaces` }, { id: 42 },
      ] });
    }
    if (url.endsWith("/v1/responses")) {
      return json(200, {
        status: "completed",
        output: body?.tool_choice === "none"
          ? [{ type: "message", content: [{ type: "output_text", text: SENTINEL }] }]
          : [{ type: "function_call", name: "capture_lead", call_id: "c1", arguments: `{"fullName":"${SENTINEL}"}` }],
        usage: { input_tokens: 900, output_tokens: 40, output_tokens_details: { reasoning_tokens: 12 } },
      });
    }
    if (overrides.chat) return overrides.chat(body ?? {});
    if (body && "max_tokens" in body) return refusal("max_tokens");
    if (body?.reasoning_effort === "none") return refusal("reasoning_effort");
    const jsonMode = (body?.response_format as { type?: string } | undefined)?.type === "json_object";
    const offered = Array.isArray(body?.tools) && body?.tool_choice !== "none";
    return json(200, {
      choices: [{
        finish_reason: offered ? "tool_calls" : "stop",
        message: offered
          ? { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "capture_lead", arguments: `{"fullName":"${SENTINEL}"}` } }] }
          : { content: jsonMode ? `{"reason":"${SENTINEL}"}` : SENTINEL },
      }],
      usage: { prompt_tokens: 700, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 8 } },
    });
  }) as typeof fetch;
  return { impl, sent };
}

const chatCalls = (sent: Sent[]) => sent.filter((s) => s.url.endsWith("/v1/chat/completions"));
const isTask = (marker: string) => (s: Sent) => JSON.stringify(s.body?.messages ?? s.body?.input ?? "").includes(marker);

describe("model-spike.ts", () => {
  it("with no OPENAI_API_KEY, exits 2 naming the variable, before any request, printing nothing on stdout", () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const r = spawnSync(process.execPath, [TSX_CLI, SPIKE], { cwd: WEB, env, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("OPENAI_API_KEY is not set");
    expect(r.stdout).toBe("");
  });

  it("asks for gpt-6-luna on every completion, with the key in the Authorization header only", async () => {
    const { impl, sent } = fakeOpenAi();
    const out = await runModelSpike(impl, KEY);
    expect(SPIKE_MODEL).toBe("gpt-6-luna");
    const posts = sent.filter((s) => s.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((s) => s.body?.model === "gpt-6-luna")).toBe(true);
    expect(sent.every((s) => s.auth === `Bearer ${KEY}`)).toBe(true);
    expect(out.markdown).not.toContain(KEY);
  });

  it("sends V1 as today's row, V2 with max_completion_tokens instead, and V3 as V2 plus each reasoning effort (call_card: 300 tokens, JSON mode)", async () => {
    const { impl, sent } = fakeOpenAi();
    await runModelSpike(impl, KEY);
    // The call card's system prompt asks for a "reason" and a "quote".
    const card = chatCalls(sent).filter(isTask("sticky note")).map((s) => s.body!);
    const strip = ({ model, messages, ...rest }: Record<string, unknown>) => { void model; void messages; return rest; };
    const shapes = [...new Set(card.map((b) => JSON.stringify(strip(b))))].map((s) => JSON.parse(s) as Record<string, unknown>);
    expect(shapes).toEqual([
      { response_format: { type: "json_object" }, max_tokens: 300 },
      { response_format: { type: "json_object" }, max_completion_tokens: 300 },
      { response_format: { type: "json_object" }, max_completion_tokens: 300, reasoning_effort: "none" },
      { response_format: { type: "json_object" }, max_completion_tokens: 300, reasoning_effort: "minimal" },
      { response_format: { type: "json_object" }, max_completion_tokens: 300, reasoning_effort: "low" },
    ]);
  });

  it("runs an accepted variant 5 times and a refused one once (mutation: always 5, or always 1 → FAILS)", async () => {
    const { impl, sent } = fakeOpenAi();
    await runModelSpike(impl, KEY);
    const card = chatCalls(sent).filter(isTask("sticky note")).map((s) => s.body!);
    const count = (pred: (b: Record<string, unknown>) => boolean) => card.filter(pred).length;
    expect(count((b) => "max_tokens" in b)).toBe(1);
    expect(count((b) => "max_completion_tokens" in b && !("reasoning_effort" in b))).toBe(5);
    expect(count((b) => b.reasoning_effort === "none")).toBe(1);
    expect(count((b) => b.reasoning_effort === "minimal")).toBe(5);
    expect(count((b) => b.reasoning_effort === "low")).toBe(5);
  });

  it("covers all five tasks; the summary skips V2 where today's row has no cap (call_summary) and says so", async () => {
    const { impl, sent } = fakeOpenAi();
    const out = await runModelSpike(impl, KEY);
    for (const task of ["web_chat", "call_summary", "call_card", "call_proposals", "record_summary"]) {
      expect(out.markdown).toContain(`| ${task} |`);
    }
    // call_summary sends no cap: no request of its own ever carries a cap field.
    const summary = chatCalls(sent).filter(isTask("Summarize this front-desk call")).map((s) => s.body!);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((b) => "max_tokens" in b || "max_completion_tokens" in b)).toBe(false);
    expect(out.markdown).toContain("call_summary sends no cap today, so V2 is V1");
  });

  it("prints a refusal as code / type / param only, never the error's message (mutation: print the body → FAILS)", async () => {
    const { impl } = fakeOpenAi();
    const out = await runModelSpike(impl, KEY);
    expect(out.markdown).toContain("error: unsupported_parameter / invalid_request_error / param max_tokens");
    expect(out.markdown).toContain("error: unsupported_parameter / invalid_request_error / param reasoning_effort");
    expect(out.markdown).not.toContain(SENTINEL);
  });

  it("never prints a model's words: only empty y/n, JSON parses y/n and tool call y/n (mutation: print the content → FAILS)", async () => {
    const { impl } = fakeOpenAi();
    const out = await runModelSpike(impl, KEY);
    expect(out.markdown).not.toContain(SENTINEL);
    // call_card's accepted runs: content present, JSON parses, finish stop, the three token counts.
    expect(out.markdown).toMatch(/\| call_card \| V2 \| chat \| 1 \| 200 \| - \| stop \| 700 \| 30 \| 8 \| \d+ \| n \| y \| - \|/);
    // web_chat's first turn on Chat Completions: no text, a tool call.
    expect(out.markdown).toMatch(/\| web_chat \| V2 \| chat \| 1 \| 200 \| - \| tool_calls \| 700 \| 30 \| 8 \| \d+ \| y \| - \| y \|/);
  });

  it("web_chat only: the follow-up shape (tool result, tool_choice none) on Chat Completions, then the first turn and the follow-up on /v1/responses with flat tools", async () => {
    const { impl, sent } = fakeOpenAi();
    const out = await runModelSpike(impl, KEY);
    const followups = chatCalls(sent).filter((s) => s.body?.tool_choice === "none");
    expect(followups).toHaveLength(5);
    const roles = (followups[0]!.body!.messages as { role: string }[]).map((m) => m.role);
    expect(roles.slice(-2)).toEqual(["assistant", "tool"]);

    const responses = sent.filter((s) => s.url === "https://api.openai.com/v1/responses");
    expect(responses).toHaveLength(10);
    for (const r of responses) {
      expect(r.body!.store).toBe(false);
      const tools = r.body!.tools as Record<string, unknown>[];
      expect(tools[0]).toMatchObject({ type: "function", name: "capture_lead" });
      expect(tools[0]).not.toHaveProperty("function");
      expect(r.body).not.toHaveProperty("max_tokens");
      expect(r.body).not.toHaveProperty("max_completion_tokens");
      expect(r.body!.max_output_tokens).toBe(500);
    }
    const followup = responses.filter((r) => r.body!.tool_choice === "none");
    expect(followup).toHaveLength(5);
    const types = (followup[0]!.body!.input as { type?: string }[]).map((i) => i.type ?? "message");
    expect(types.slice(-2)).toEqual(["function_call", "function_call_output"]);
    expect(out.markdown).toMatch(/\| web_chat \| responses first turn \| responses \| 1 \| 200 \| - \| completed \| 900 \| 40 \| 12 \| \d+ \| y \| - \| y \|/);
    expect(out.markdown).toMatch(/\| web_chat \| responses follow-up \| responses \| 1 \| 200 \| - \| completed \| 900 \| 40 \| 12 \| \d+ \| n \| - \| n \|/);
  });

  it("lists only gpt-6*, gpt-realtime*, gpt-transcribe* and gpt-live* models, each as identifier characters", async () => {
    const { impl } = fakeOpenAi();
    const out = await runModelSpike(impl, KEY);
    const section = out.markdown.slice(out.markdown.indexOf("## Models this key can see"));
    expect(section).toContain("gpt-6-luna");
    expect(section).toContain("gpt-realtime-2.1");
    expect(section).toContain("gpt-transcribe");
    expect(section).toContain("gpt-live-transcribe");
    expect(section).not.toContain("gpt-4o-mini");
    expect(section).not.toContain("whisper-1");
    expect(section).not.toContain(" with spaces");
  });

  it("records a network failure by its class, a timeout as timeout, and a 200 that is not JSON, without printing any of their text", async () => {
    let n = 0;
    const { impl } = fakeOpenAi({
      chat: () => {
        n += 1;
        if (n % 3 === 1) throw Object.assign(new TypeError(SENTINEL));
        if (n % 3 === 2) throw Object.assign(new Error(SENTINEL), { name: "TimeoutError" });
        return new Response(`${SENTINEL} not json`, { status: 200 });
      },
    });
    const out = await runModelSpike(impl, KEY);
    expect(out.markdown).toContain("| network | TypeError |");
    expect(out.markdown).toContain("| timeout |");
    expect(out.markdown).toContain("| 200 | an answer that did not parse |");
    expect(out.markdown).not.toContain(SENTINEL);
  });

  /** A fetch that answers only when its signal aborts, with the signal's own reason (a TimeoutError). */
  const hangs = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  })) as typeof fetch;

  it("bounds every call: a request that never answers becomes a `timeout` row, the models list included (mutation: drop the call's signal → FAILS by hanging)", async () => {
    const out = await runModelSpike(hangs, KEY, { callTimeoutMs: 20 });
    expect(out.markdown).toContain("GET /v1/models: timeout");
    expect(out.markdown).toMatch(/\| call_card \| V1 \| chat \| 1 \| timeout \| - \|/);
    expect(out.markdown).not.toMatch(/\| network \|/);
  });

  it("records a timeout while READING the answer as `timeout`, not as an answer that did not parse", async () => {
    const { impl } = fakeOpenAi({
      chat: () => ({ ok: true, status: 200, json: () => Promise.reject(Object.assign(new Error(SENTINEL), { name: "TimeoutError" })) }) as unknown as Response,
    });
    const out = await runModelSpike(impl, KEY);
    expect(out.markdown).toMatch(/\| call_card \| V1 \| chat \| 1 \| timeout \| - \|/);
    expect(out.markdown).not.toContain("did not parse");
    expect(out.markdown).not.toContain(SENTINEL);
  });

  it("starts no call past the overall deadline and says where it stopped (mutation: drop the deadline check → FAILS)", async () => {
    let t = 0;
    const { impl, sent } = fakeOpenAi();
    const ticking = ((input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).endsWith("/v1/models")) t += 10 * 60_000; // each completion takes ten minutes
      return impl(input, init);
    }) as typeof fetch;
    const out = await runModelSpike(ticking, KEY, { clock: () => t });
    // 45 minutes: calls start at 0, 10, 20, 30 and 40 minutes; none at 50.
    expect(sent.filter((s) => s.method === "POST")).toHaveLength(5);
    expect(out.markdown).toContain("Stopped early at 5 calls: the 45-minute deadline.");
    expect(out.everyTaskAccepted).toBe(false);
  });

  it("emits each task's rows as soon as that task finishes, and the models list first, so a killed job still leaves them (mutation: emit only at the end → FAILS)", async () => {
    const emitted: string[] = [];
    let seenWhenSecondTaskStarted = "";
    const { impl } = fakeOpenAi();
    const watching = ((input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (!seenWhenSecondTaskStarted && body.includes("Summarize this front-desk call")) seenWhenSecondTaskStarted = emitted.join("\n");
      return impl(input, init);
    }) as typeof fetch;
    const out = await runModelSpike(watching, KEY, { emit: (chunk) => emitted.push(chunk) });
    expect(seenWhenSecondTaskStarted).toContain("## Models this key can see");
    expect(seenWhenSecondTaskStarted).toContain("| web_chat | V1 |");
    expect(seenWhenSecondTaskStarted).not.toContain("| call_summary |");
    expect(emitted.join("\n")).toBe(out.markdown);
  });

  it("is a pass when every task had an accepted variant, and not when Chat Completions refuses everything", async () => {
    expect((await runModelSpike(fakeOpenAi().impl, KEY)).everyTaskAccepted).toBe(true);
    const out = await runModelSpike(fakeOpenAi({ chat: () => refusal("model") }).impl, KEY);
    expect(out.everyTaskAccepted).toBe(false);
  });
});
