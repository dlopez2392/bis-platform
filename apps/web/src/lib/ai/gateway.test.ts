import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aiComplete, AI_REFUSALS, type AiInput } from "./gateway";
import { openGateDb, OPEN_GATE, type GateOver } from "./testing/open-gate";

/** Spec 3.1, 3.5, 6, 8.1, 8.2 (gateway). The client is the open-gate fake; the provider is a stubbed fetch. */
const SYSTEM = "SENTINEL-PROMPT-7f3 system rules";
const base = (o: Partial<AiInput> = {}): AiInput => ({
  accountId: "acct1", feature: "call_summary", model: "gpt-4o-mini",
  messages: [{ role: "system", content: SYSTEM }, { role: "user", content: "what are your hours?" }],
  timeoutMs: 10_000, timezone: "America/Chicago", ref: "call c1", now: new Date("2026-10-18T15:00:00Z"), ...o,
});
const answer = (content: unknown, usage: unknown = { prompt_tokens: 4000, completion_tokens: 200 }, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status })) as unknown as typeof fetch;
const ledgerOf = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === "ai_ledger_record").map((c) => c.args);
const keysOf = (args: Record<string, unknown>) => ({ p_month: args.p_month, p_day: args.p_day });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("AI_GATEWAY_OFF", "");
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("aiComplete: an answer", () => {
  it("returns the text and its usage, and records one ok row in the ACCOUNT's month and day (mutation: periodKeys in UTC -> p_month 2026-11 -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const r = await aiComplete(db, base({ fetchImpl: answer("Caller asked about hours."), now: new Date("2026-11-01T04:30:00Z") }));
    expect(r).toEqual({ ok: true, text: "Caller asked about hours.", usage: { inputTokens: 4000, outputTokens: 200, costMicroUsd: 720 } });
    expect(calls.map((c) => c.fn)).toEqual(["ai_gate_check", "ai_ledger_record"]);
    expect(calls[0]!.args).toEqual({ p_account: "acct1", p_month: "2026-10", p_day: "2026-10-31" });
    expect(ledgerOf(calls)[0]).toMatchObject({
      p_account: "acct1", p_feature: "call_summary", p_model: "gpt-4o-mini", p_in: 4000, p_out: 200, p_cost: 720,
      p_outcome: "ok", p_month: "2026-10", p_day: "2026-10-31",
    });
  });

  it("a zone AHEAD of UTC: both RPCs carry Auckland's Nov 1 while UTC is still Oct 31 (mutation: periodKeys in UTC -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    await aiComplete(db, base({ fetchImpl: answer("x"), timezone: "Pacific/Auckland", now: new Date("2026-10-31T23:30:00Z") }));
    expect(calls.map((c) => [c.fn, keysOf(c.args)])).toEqual([
      ["ai_gate_check", { p_month: "2026-11", p_day: "2026-11-01" }],
      ["ai_ledger_record", { p_month: "2026-11", p_day: "2026-11-01" }],
    ]);
  });

  it("an unusable zone falls back to Chicago's month and day, never UTC's (mutation: periodKeys(now, input.timezone) unguarded -> RangeError -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const r = await aiComplete(db, base({ fetchImpl: answer("x"), timezone: "Not/AZone", now: new Date("2026-11-01T04:30:00Z") }));
    expect(r.ok).toBe(true);
    expect(calls.map((c) => keysOf(c.args))).toEqual([{ p_month: "2026-10", p_day: "2026-10-31" }, { p_month: "2026-10", p_day: "2026-10-31" }]);
  });

  // 0086 accepts any well-formed key, far-future ones included, and relies on the app sending only the
  // account-zone date of the real clock. With no `now`, the keys are today's, within a day of UTC's.
  it("with no `now`, both RPCs carry the REAL clock's keys, never a far-future one (mutation: default now to new Date(8.64e15) -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const before = Date.now();
    await aiComplete(db, { ...base({ fetchImpl: answer("x"), timezone: "Pacific/Kiritimati" }), now: undefined });
    const day = String(calls[0]!.args.p_day);
    const utcToday = new Date(before).toISOString().slice(0, 10);
    expect(Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${utcToday}T00:00:00Z`))).toBeLessThanOrEqual(86_400_000);
    expect(calls.map((c) => keysOf(c.args))).toEqual([{ p_month: day.slice(0, 7), p_day: day }, { p_month: day.slice(0, 7), p_day: day }]);
  });

  it("an invalid `now` sends no key at all and never throws (mutation: catch periodKeys' RangeError and send a fixed key -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    await expect(aiComplete(db, base({ fetchImpl, now: new Date(Number.NaN) }))).resolves.toEqual({ ok: false, reason: "provider_error" });
    expect(calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the caller's model, messages, JSON mode, token cap and time limit; 3 s, 10 s, 3 s in that order (mutations: drop response_format; timeoutMs 600_000 -> FAILS)", async () => {
    const { db } = openGateDb();
    const fetchImpl = answer("{}");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await aiComplete(db, base({ fetchImpl, responseFormat: { type: "json_object" }, maxTokens: 2000 }));
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4o-mini", messages: base().messages, response_format: { type: "json_object" }, max_tokens: 2000,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Review I2: the exact sequence (gate, completion, ledger), not "was called with" (which one call satisfies).
    expect(timeout.mock.calls.map((c) => c[0])).toEqual([3_000, 10_000, 3_000]);
  });

  it("both RPCs are bounded: each was handed an abort signal (plan deviation 5; mutations: drop the gate's signal; drop the ledger's -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    await aiComplete(db, base({ fetchImpl: answer("x") }));
    expect(calls.map((c) => [c.fn, c.signalled])).toEqual([["ai_gate_check", true], ["ai_ledger_record", true]]);
  });

  it("with no usage in the answer, estimates the cost from the characters, never free (spec 3.5; mutation: cost 0 when usage is missing -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const msgs = [{ role: "system" as const, content: "a".repeat(400) }, { role: "user" as const, content: "b".repeat(400) }];
    const r = await aiComplete(db, base({ messages: msgs, fetchImpl: answer("c".repeat(40), null) }));
    // 800 prompt characters -> 200 tokens; 40 answer characters -> 10 tokens; ceil((200*150000 + 10*600000) / 1e6) = 36.
    expect(r).toEqual({ ok: true, text: "c".repeat(40), usage: { inputTokens: null, outputTokens: null, costMicroUsd: 36 } });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_in: null, p_out: null, p_cost: 36 });
  });

  it("a failed ledger write keeps the text and logs ids only (mutation: return a refusal when the ledger throws -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await aiComplete(openGateDb({ ledger: "error" }).db, base({ fetchImpl: answer("x") }));
    expect(r.ok).toBe(true);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toBe("ai: ledger write failed for account acct1 feature call_summary outcome ok: Error: recordAiLedger failed: ledger unavailable");
  });

  // recordAiLedger's own contract: a failed or timed-out call may still have committed its row, so a retry
  // could write the row twice and count the cost twice.
  it("a failed ledger write is NEVER retried (mutation: retry the ledger once on failure -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb({ ledger: "error" });
    await aiComplete(db, base({ fetchImpl: answer("x") }));
    expect(calls.map((c) => c.fn)).toEqual(["ai_gate_check", "ai_ledger_record"]);
  });

  it("an ok call logs nothing at all (plan deviation 8; mutation: log every outcome -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await aiComplete(openGateDb().db, base({ fetchImpl: answer("x") }));
    expect([err.mock.calls.length, log.mock.calls.length]).toEqual([0, 0]);
  });
});

describe("aiComplete: every refusal is a reason, never a request (spec 3.1 steps 1-4)", () => {
  it("AI_REFUSALS is the eight non-ok outcomes", () => {
    expect(AI_REFUSALS).toEqual(["global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"]);
  });

  it("AI_GATEWAY_OFF=1: global_off with no database read and no ledger row (mutation: drop the env check -> FAILS)", async () => {
    vi.stubEnv("AI_GATEWAY_OFF", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "global_off" });
    expect(calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // [what closes it, the reason, the mutation that fails the row]
  const gated: [GateOver, string, string][] = [
    [{ gate: { global_enabled: false } }, "global_off", "drop the global check"],
    [{ gate: { account_enabled: false } }, "account_off", "drop the account check"],
    [{ gate: { month_spend_microusd: OPEN_GATE.budget_microusd } }, "over_budget", "`>` instead of `>=`"],
    [{ gate: "error" }, "gate_unreadable", "treat a failed gate as open"],
  ];
  it.each(gated)("%j -> %s, one zero-cost ledger row, no request (mutation: %s -> FAILS)", async (over, reason) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb(over);
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ledgerOf(calls)).toEqual([expect.objectContaining({ p_outcome: reason, p_in: null, p_out: null, p_cost: 0 })]);
  });

  it("one micro-dollar under the budget still answers (pairs with the over_budget row above)", async () => {
    const { db } = openGateDb({ gate: { month_spend_microusd: OPEN_GATE.budget_microusd - 1 } });
    expect((await aiComplete(db, base({ fetchImpl: answer("x") }))).ok).toBe(true);
  });

  it("an unknown model is refused before the gate, so it cannot spend unmetered (mutation: skip the price check -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ model: "gpt-9", fetchImpl }))).toEqual({ ok: false, reason: "unknown_model" });
    expect(calls.map((c) => c.fn)).toEqual(["ai_ledger_record"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no key: no request, a no_key row, one error line naming the call (mutation: drop the gateway's no_key log -> FAILS)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "no_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ledgerOf(calls)[0]).toMatchObject({ p_outcome: "no_key", p_cost: 0 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): no_key after \d+ ms$/);
  });

  it("a switched-off account never reports a missing key (plan deviation 7; mutation: check the key before the gate -> FAILS)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await aiComplete(openGateDb({ gate: { account_enabled: false } }).db, base({ fetchImpl: answer("x") }))).toEqual({ ok: false, reason: "account_off" });
    expect(err).not.toHaveBeenCalled();
  });

  it("the three expected states log on console.log, never console.error (plan deviation 8; mutation: log every refusal as an error -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await aiComplete(openGateDb({ gate: { account_enabled: false } }).db, base({ fetchImpl: answer("x") }));
    expect(err).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): account_off after \d+ ms$/);
  });
});

describe("aiComplete: a failing provider is a reason, never a throw (spec 3.1 step 5)", () => {
  it("a timeout is timeout, with null tokens and zero cost (mutation: map TimeoutError to provider_error -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = vi.fn(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); }) as unknown as typeof fetch;
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "timeout" });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_outcome: "timeout", p_in: null, p_out: null, p_cost: 0 });
  });

  it("a non-ok answer is provider_error, its body never read, its status logged (mutation: read the body for the log -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = new Response(JSON.stringify({ error: { message: SYSTEM } }), { status: 400 });
    const json = vi.spyOn(res, "json");
    const text = vi.spyOn(res, "text");
    const r = await aiComplete(openGateDb().db, base({ fetchImpl: vi.fn(async () => res) as unknown as typeof fetch }));
    expect(r).toEqual({ ok: false, reason: "provider_error" });
    expect([json.mock.calls.length, text.mock.calls.length]).toEqual([0, 0]);
    expect(String(err.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): provider_error HTTP 400 after \d+ ms$/);
  });

  // Review I3, as RUN (not as predicted): dropping openai.ts's content-type branch surfaces as neither a SyntaxError
  // nor a TypeError. The answer here reports both token counts, so the cost never reads `text.length`, and the
  // gateway answers `{ ok: true, text: null }`: the result itself is what fails. (Only an answer that ALSO omits
  // completion_tokens would reach `null.length`, a TypeError the outer catch turns into provider_error with no row.)
  it("an answer with no text is provider_error, charged from the usage it reported, its line saying 'no content' (plan deviation 10; mutations: record cost 0; drop openai.ts's content-type branch -> ok with text null -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    expect(await aiComplete(db, base({ fetchImpl: answer(null) }))).toEqual({ ok: false, reason: "provider_error" });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_outcome: "provider_error", p_in: 4000, p_out: 200, p_cost: 720 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): provider_error \(no content in the answer\) after \d+ ms$/);
  });

  it("an answer with no text AND no usage is provider_error with its zero-cost row (mutation: drop openai.ts's content-type branch -> `null.length` TypeError in the outer catch, no row -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    expect(await aiComplete(db, base({ fetchImpl: answer(null, null) }))).toEqual({ ok: false, reason: "provider_error" });
    expect(ledgerOf(calls)).toEqual([expect.objectContaining({ p_outcome: "provider_error", p_in: null, p_out: null, p_cost: 0 })]);
    expect(String(err.mock.calls[0]![0])).toMatch(/: provider_error \(no content in the answer\) after \d+ ms$/);
  });

  it("a client whose rpc throws synchronously reads as gate_unreadable, never a throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { rpc: () => { throw new Error("boom"); } } as unknown as Parameters<typeof aiComplete>[0];
    await expect(aiComplete(db, base({ fetchImpl: answer("x") }))).resolves.toEqual({ ok: false, reason: "gate_unreadable" });
  });
});

describe("aiComplete never logs or stores a prompt or an output (spec 3.1, G3, 8.2)", () => {
  const OUTPUT = "SENTINEL-OUTPUT-7f3 the model's words";
  const spies = () => (["log", "error", "warn", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
  const said = (s: ReturnType<typeof spies>) => s.flatMap((x) => x.mock.calls.flat().map(String)).join("\n");

  // [the path's name, a fetch for it] (the name first, so %s titles the row with it)
  const paths: [string, () => typeof fetch][] = [
    ["ok", () => answer(OUTPUT)],
    ["a 400 that echoes the prompt", () => vi.fn(async () => new Response(JSON.stringify({ error: { message: `${SYSTEM} ${OUTPUT}` } }), { status: 400 })) as unknown as typeof fetch],
    ["an answer that does not parse", () => vi.fn(async () => new Response(`${OUTPUT} not json`, { status: 200 })) as unknown as typeof fetch],
    ["a network error whose message carries both", () => vi.fn(async () => { throw new TypeError(`${SYSTEM} ${OUTPUT}`); }) as unknown as typeof fetch],
  ];
  it.each(paths)("%#: %s -> no sentinel in any console method or any RPC argument (mutations: log String(e) on the provider path; log the body of a non-ok answer -> FAILS)", async (_name, fetchFor) => {
    const s = spies();
    const { db, calls } = openGateDb();
    await aiComplete(db, base({ fetchImpl: fetchFor() }));
    expect(`${said(s)}\n${JSON.stringify(calls)}`).not.toContain("SENTINEL");
  });
});

describe("the fake provider (spec 6, 8.1)", () => {
  it("AI_PROVIDER=fake answers with no network call, a fixed usage and a hash (mutation: never select the fake -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    const r = await aiComplete(db, base({ fetchImpl, language: "es" }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, usage: { inputTokens: 100, outputTokens: 20, costMicroUsd: 27 } });
    expect(r.ok ? r.text : "").toMatch(/^\[fake es\] [0-9a-f]{8}$/);
    expect(ledgerOf(calls)[0]).toMatchObject({ p_in: 100, p_out: 20, p_cost: 27, p_outcome: "ok" });
  });

  it("is IGNORED in production: VERCEL_ENV=production always calls OpenAI (spec 6; mutation: drop the VERCEL_ENV check -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.stubEnv("VERCEL_ENV", "production");
    const fetchImpl = answer("real");
    const r = await aiComplete(openGateDb().db, base({ fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, text: "real" });
  });

  it("in JSON mode it answers JSON every caller reads as 'nothing' (mutation: answer plain text in JSON mode -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    const r = await aiComplete(openGateDb().db, base({ responseFormat: { type: "json_object" } }));
    expect(JSON.parse(r.ok ? r.text : "null")).toMatchObject({ proposals: [], reason: null, quote: null });
  });

  it("still goes through the gate: a switched-off account gets no fake answer either (mutation: return the fake before the gate -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await aiComplete(openGateDb({ gate: { account_enabled: false } }).db, base())).toEqual({ ok: false, reason: "account_off" });
  });
});
