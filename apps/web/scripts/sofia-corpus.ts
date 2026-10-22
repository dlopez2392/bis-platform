// pnpm --filter web sofia:corpus <insurance-pc|events> [--only NN] [--phone-engine realtime|chat] [--dry-run]
//
// S-47b (spec section 7): plays each corpus item's caller lines through Sofía's REAL prompt and tools for
// that item's medium, one line after each reply, with every tool stubbed (ok, and logged), and writes one
// transcript per item plus an ungraded results sheet to apps/web/.sofia-corpus/ (gitignored). A PERSON
// grades every rule (owner decision B5); the graded sheet goes to docs/superpowers/results/.
//
// It never touches a database and never reads an env file. OPENAI_API_KEY comes from the shell only and is
// never printed. It refuses to start when any Supabase/PG variable in the shell names production.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { refuseProduction } from "../e2e/fixtures/production-guard";
import { buildSystemPrompt } from "../src/lib/voice/system-prompt";
import { REALTIME_MODEL, type VoicePromptInput } from "../src/lib/voice/session-config";
import { openingGreeting } from "../src/lib/voice/greeting";
import { budgetNotice } from "../src/lib/concierge/prompt";
import { CONCIERGE_MAX_TURNS, CONCIERGE_MAX_REPLY_TOKENS, CONCIERGE_MODEL } from "../src/lib/concierge/guards";
import { TRADE_MODULES } from "../src/lib/voice/modules";
import { moduleTextSha256 } from "../src/lib/voice/modules/pin";
import {
  parseCorpusItem, parseFixture, promptInputFor, toolsFor, realtimeToolAsChat, stubToolResult,
  renderTranscript, resultsSheetSkeleton, moduleForSlug, redact, DEFAULT_PHONE_ENGINE, PHONE_FALLBACK_MODEL,
  type CorpusItem, type CorpusFixture, type PhoneEngine, type RunMeta, type TranscriptTurn,
} from "../src/lib/voice/modules/corpus-lib";

refuseProduction(process.env, "sofia:corpus");

const TEXT_MODALITY_FIELD = "output_modalities";   // or "modalities", per Task 0's spike
const MAX_TOOL_ROUNDS = 6;
const RESPONSE_TIMEOUT_MS = 45_000;

const args = process.argv.slice(2);
const slug = args[0] ?? "";
const moduleId = moduleForSlug(slug);
if (!moduleId) { console.error("usage: sofia:corpus <insurance-pc|events> [--only NN] [--phone-engine realtime|chat] [--dry-run]"); process.exit(2); }
const flag = (n: string) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1] ?? null; };
const only = flag("--only");
const engineArg = flag("--phone-engine");
const phoneEngine: PhoneEngine = engineArg === "chat" || engineArg === "realtime" ? engineArg : DEFAULT_PHONE_ENGINE;
const dryRun = args.includes("--dry-run");
const key = process.env.OPENAI_API_KEY ?? "";
if (!dryRun && !key) { console.error("OPENAI_API_KEY is not set in this shell (it is never read from a file)"); process.exit(2); }

const corpusDir = path.resolve(__dirname, "../src/lib/voice/modules/corpus");
const mod = TRADE_MODULES[moduleId];
const date = new Date().toISOString().slice(0, 10);
const meta: RunMeta = {
  moduleId, slug, version: mod.version, sha256: moduleTextSha256(mod), date, phoneEngine,
  phoneModel: phoneEngine === "realtime" ? REALTIME_MODEL : PHONE_FALLBACK_MODEL, chatModel: CONCIERGE_MODEL,
};
const outDir = path.resolve(__dirname, "../.sofia-corpus", slug, new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(outDir, { recursive: true });

const fixtures = new Map<string, CorpusFixture>();
const fixtureFor = (name: string) => {
  if (!fixtures.has(name)) fixtures.set(name, parseFixture(name, readFileSync(path.join(corpusDir, "fixtures", `${name}.json`), "utf8")));
  return fixtures.get(name)!;
};

const safeJson = (raw: unknown): Record<string, unknown> => {
  try { return JSON.parse(String(raw ?? "{}")) as Record<string, unknown>; } catch { return {}; }
};

async function runRealtime(input: VoicePromptInput, tools: unknown[], greeting: string, lines: string[]): Promise<TranscriptTurn[]> {
  const turns: TranscriptTurn[] = [];
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
    { headers: { Authorization: `Bearer ${key}` } });
  const send = (o: unknown) => ws.send(JSON.stringify(o));
  let text = ""; let toolRounds = 0; let toolPending = false;
  let waiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let sessionReady: (() => void) | null = null;
  let sessionFailed: ((e: Error) => void) | null = null;
  ws.on("message", (raw) => {
    const ev = JSON.parse(String(raw)) as { type: string; delta?: string; name?: string; call_id?: string; arguments?: string; error?: { code?: string; type?: string } };
    if (ev.type === "session.updated") sessionReady?.();
    // M3: the error's CODE only, never its message (a message can echo a key or a header).
    else if (ev.type === "error") {
      const e = new Error(`realtime error: ${ev.error?.code ?? ev.error?.type ?? "unknown"}`);
      if (waiter) waiter.reject(e); else sessionFailed?.(e);
    }
    else if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
    else if (ev.type === "response.function_call_arguments.done") {
      const a = safeJson(ev.arguments);
      const result = stubToolResult(String(ev.name), a);
      turns.push({ role: "tool", text: `${ev.name}(${JSON.stringify(a)}) -> ${JSON.stringify(result)}` });
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(result) } });
      toolPending = true;
    } else if (ev.type === "response.done") {
      if (text.trim()) turns.push({ role: "sofia", text: text.trim() });
      text = "";
      if (toolPending && toolRounds < MAX_TOOL_ROUNDS) { toolPending = false; toolRounds += 1; send({ type: "response.create" }); }
      else { toolPending = false; const w = waiter; waiter = null; w?.resolve(); }
    }
  });
  // M14: every awaited event has a timeout, so a socket that never opens or a session that is never
  // confirmed fails this item instead of hanging the run.
  const within = <T,>(what: string, p: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { ws.terminate(); reject(new Error(`${what}: no answer within ${RESPONSE_TIMEOUT_MS} ms`)); }, RESPONSE_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
  await within("socket open", new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", (e: Error) => rej(new Error(`socket error: ${e.name}`))); }));
  await within("session.updated", new Promise<void>((res, rej) => {
    sessionReady = res;
    sessionFailed = rej;
    send({ type: "session.update", session: {
      type: "realtime", model: REALTIME_MODEL, instructions: buildSystemPrompt(input, new Date()),
      tools, [TEXT_MODALITY_FIELD]: ["text"],
    } });
  }));
  const respond = (payload?: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no response.done in time")), RESPONSE_TIMEOUT_MS);
    toolRounds = 0;
    waiter = { resolve: () => { clearTimeout(t); resolve(); }, reject: (e) => { clearTimeout(t); reject(e); } };
    send(payload ? { type: "response.create", response: payload } : { type: "response.create" });
  });
  await respond({ instructions: greeting });   // the live route's greeting send (incoming/route.ts, the greetTimer's response.create)
  for (const line of lines) {
    turns.push({ role: "caller", text: line });
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: line }] } });
    await respond();
  }
  ws.close();
  return turns;
}

type ChatMsg = { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string };

async function complete(model: string, messages: ChatMsg[], tools: unknown[], maxTokens?: number): Promise<ChatMsg> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
    signal: AbortSignal.timeout(RESPONSE_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`openai ${r.status}`);
  const data = await r.json() as { choices?: Array<{ message?: ChatMsg }> };
  return data.choices?.[0]?.message ?? { role: "assistant", content: "" };
}

/** Chat completions: the website chat (its own model, budget notice and reply cap, as the concierge turn
 *  route builds them), or the phone fallback (gpt-4o, the phone prompt and tools, the greeting as a system
 *  instruction). */
async function runChat(model: string, system: (turn: number) => string, tools: unknown[], lines: string[],
  opts: { greeting?: string; maxTokens?: number }): Promise<TranscriptTurn[]> {
  const turns: TranscriptTurn[] = []; const history: ChatMsg[] = [];
  if (opts.greeting) {
    const g = await complete(model, [{ role: "system", content: system(0) }, { role: "system", content: opts.greeting }], tools, opts.maxTokens);
    if (g.content) { turns.push({ role: "sofia", text: g.content }); history.push({ role: "assistant", content: g.content }); }
  }
  for (const [i, line] of lines.entries()) {
    turns.push({ role: "caller", text: line });
    history.push({ role: "user", content: line });
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const msg = await complete(model, [{ role: "system", content: system(i + 1) }, ...history], tools, opts.maxTokens);
      if (msg.tool_calls?.length) {
        history.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const c of msg.tool_calls) {
          const a = safeJson(c.function.arguments);
          const result = stubToolResult(c.function.name, a);
          turns.push({ role: "tool", text: `${c.function.name}(${JSON.stringify(a)}) -> ${JSON.stringify(result)}` });
          history.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
        }
        continue;
      }
      if (msg.content) { turns.push({ role: "sofia", text: msg.content }); history.push({ role: "assistant", content: msg.content }); }
      break;
    }
  }
  return turns;
}

async function runItem(item: CorpusItem): Promise<TranscriptTurn[]> {
  const f = fixtureFor(item.facts);
  const input = promptInputFor(item, f, moduleId!);
  const tools = toolsFor(item, input);
  if (dryRun) return [{ role: "tool", text: `dry run: ${tools.map((t) => t.name).join(", ")}; prompt ${buildSystemPrompt(input, new Date()).length} chars` }];
  if (item.medium === "web") {
    // The chat route's system prompt per turn: the prompt plus budgetNotice(MAX - claimed + 1), claimed = turn.
    return runChat(CONCIERGE_MODEL, (turn) => buildSystemPrompt(input, new Date()) + budgetNotice(CONCIERGE_MAX_TURNS - Math.max(turn, 1) + 1),
      tools.map((t) => t.schema), item.caller, { maxTokens: CONCIERGE_MAX_REPLY_TOKENS });
  }
  const greeting = openingGreeting({ languages: f.languages, greeting_en: f.greetingEn, greeting_es: f.greetingEs },
    f.businessName, { disclose: item.disclosure, personaName: f.personaName }).instruction;
  if (phoneEngine === "realtime") return runRealtime(input, tools.map((t) => t.schema), greeting, item.caller);
  return runChat(PHONE_FALLBACK_MODEL, () => buildSystemPrompt(input, new Date()), tools.map((t) => realtimeToolAsChat(t.schema)),
    item.caller, { greeting });
}

async function main(): Promise<void> {
  const dir = path.join(corpusDir, slug);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort()
    .filter((f) => only === null || f.startsWith(`${only}-`));
  const items = files.map((f) => parseCorpusItem(f, readFileSync(path.join(dir, f), "utf8")));
  let failed = 0;
  for (const item of items) {
    try {
      const turns = await runItem(item);
      writeFileSync(path.join(outDir, item.file), redact(renderTranscript(item, meta, turns)), "utf8");
      console.log(`ok   ${item.file}`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${item.file}: ${redact(e instanceof Error ? e.message : String(e))}`);
    }
  }
  writeFileSync(path.join(outDir, "results-sheet.md"), resultsSheetSkeleton(meta, items), "utf8");
  console.log(`${items.length - failed} of ${items.length} played; transcripts and the ungraded sheet in ${outDir}`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
