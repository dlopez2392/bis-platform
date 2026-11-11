// pnpm --filter web exec tsx scripts/owner-line-corpus.ts --repeat 3
//
// F-032 spec §7 "No-guessing runs" (plan Task 14, run O-4): plays each item in src/lib/owner-line/corpus/items.json
// through the REAL owner-line session (buildOwnerLineSessionConfig: its prompt and ONLY the owner tools) over a
// text-only Realtime session (the protocol scripts/sofia-corpus.ts proved: output_modalities ["text"], and nothing
// sent before session.updated), answers every tool call with the item's stub in place of runOwnerTool's result, and
// grades every answer with ungrounded() and missingMust(). --repeat N (1-5, default 3): an item passes only when all
// N runs pass. One transcript per run goes to apps/web/.owner-line-corpus/ (gitignored); a person reads them.
//
// It never touches a database and never reads an env file. OPENAI_API_KEY comes from the shell only and is never
// printed. It refuses to start when any Supabase/PG variable in the shell names production. Agents never run it
// (repo rule 7): danlo does, at O-4.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { refuseProduction } from "../e2e/fixtures/production-guard";
import { buildOwnerLineSessionConfig } from "../src/lib/owner-line/session-config";
import { ownerLineGreeting } from "../src/lib/owner-line/prompt";
import { ungrounded, missingMust, type CorpusItem } from "../src/lib/owner-line/corpus/grade";

refuseProduction(process.env, "owner-line-corpus");
const key = process.env.OPENAI_API_KEY ?? "";
if (!key) {
  console.error("OPENAI_API_KEY is not set in this shell (it is never read from a file). Usage: pnpm --filter web exec tsx scripts/owner-line-corpus.ts --repeat 3");
  process.exit(2);
}
const rIdx = process.argv.indexOf("--repeat");
const repeat = Math.min(5, Math.max(1, Number(rIdx > 0 ? process.argv[rIdx + 1] : 3) || 3));
const items = JSON.parse(readFileSync(path.resolve(__dirname, "../src/lib/owner-line/corpus/items.json"), "utf8")) as CorpusItem[];
const TIMEOUT = 45_000;
/** The session's own words (I-14): the first name and the business name the instructions below carry. */
const SESSION_WORDS = ["Dan", "Rio", "Roofing"];

async function play(item: CorpusItem): Promise<{ replies: string[]; outputs: string[] }> {
  const config = buildOwnerLineSessionConfig({ firstName: "Dan", locale: item.locale, businessName: "Rio Roofing",
    personaName: "Sofía", timezone: "America/Chicago", now: new Date("2026-11-09T21:00:00Z") });
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.model)}`,
    { headers: { Authorization: `Bearer ${key}` } });
  const send = (o: unknown) => ws.send(JSON.stringify(o));
  const replies: string[] = [];
  const outputs: string[] = [];
  let text = "";
  let toolPending = false;
  let rounds = 0;
  let done: (() => void) | null = null;
  let sessionReady: (() => void) | null = null;
  ws.on("message", (raw) => {
    const ev = JSON.parse(String(raw)) as { type: string; delta?: string; name?: string; call_id?: string; error?: { code?: string } };
    if (ev.type === "session.updated") { sessionReady?.(); sessionReady = null; }
    else if (ev.type === "error") { console.error(`${item.id}: realtime error ${ev.error?.code ?? "unknown"}`); done?.(); }
    else if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
    else if (ev.type === "response.function_call_arguments.done") {
      const result = item.stub[String(ev.name)] ?? { ok: false, error: "unknown_tool" };
      outputs.push(JSON.stringify(result));
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(result) } });
      toolPending = true;
    } else if (ev.type === "response.done") {
      if (text.trim()) replies.push(text.trim());
      text = "";
      if (toolPending && rounds < 4) { toolPending = false; rounds += 1; send({ type: "response.create" }); }
      else { toolPending = false; const d = done; done = null; d?.(); }
    }
  });
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", () => rej(new Error("socket error"))); });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("no session.updated in time")), TIMEOUT);
    sessionReady = () => { clearTimeout(t); res(); };
    send({ type: "session.update", session: { type: "realtime", model: config.model, output_modalities: ["text"],
      instructions: config.instructions, tools: config.tools } });
  });
  const turn = (payload?: object) => new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("no response.done in time")), TIMEOUT);
    rounds = 0;
    done = () => { clearTimeout(t); res(); };
    send(payload ? { type: "response.create", response: payload } : { type: "response.create" });
  });
  await turn({ instructions: ownerLineGreeting({ firstName: "Dan", locale: item.locale }) });
  for (const line of item.lines) {
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: line }] } });
    await turn();
  }
  ws.close();
  return { replies, outputs };
}

(async () => {
  const outDir = path.resolve(__dirname, "../.owner-line-corpus", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const item of items) {
    const verdicts: string[] = [];
    for (let r = 1; r <= repeat; r++) {
      let replies: string[] = [];
      let outputs: string[] = [];
      let error = "";
      try {
        ({ replies, outputs } = await play(item));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const answer = replies.slice(1).join(" ");   // replies[0] is the greeting
      // The caller's own words are not a guess when Sofía repeats them ("I can't book Maria on this line").
      const bad = ungrounded(answer, outputs, [...SESSION_WORDS, ...item.lines]);
      const missing = missingMust(answer, item.must);
      const ok = !error && answer !== "" && bad.length === 0 && missing.length === 0;
      const why = error ? [`error:${error}`] : answer === "" ? ["no-answer"] : [...bad, ...missing.map((w) => `missing:${w}`)];
      verdicts.push(ok ? "PASS" : `FAIL(${why.join(",")})`);
      writeFileSync(path.join(outDir, `${item.id}-r${r}.md`), [`# ${item.id} run ${r}`, ...item.lines.map((l) => `caller: ${l}`),
        ...outputs.map((o) => `tool: ${o}`), ...replies.map((x) => `sofia: ${x}`), `verdict: ${verdicts[verdicts.length - 1]}`].join("\n\n"));
    }
    const pass = verdicts.every((v) => v === "PASS");
    if (!pass) failed += 1;
    console.log(`${item.id}: ${verdicts.join(" ")} -> ${pass ? "PASS" : "FAIL"}`);
  }
  console.log(`${items.length - failed}/${items.length} items passed all ${repeat} runs`);
  console.log(`transcripts: ${outDir}`);
  process.exit(failed === 0 ? 0 : 1);
})();
