// pnpm --filter web exec tsx scripts/realtime-spike.ts
//
// S-47b Task 0 spike (plan docs/superpowers/plans/2026-10-21-sofia-trade-modules-pr47b.md): does gpt-realtime
// answer a TEXT-ONLY session over WebSocket built from our real session config? The corpus runner
// (scripts/sofia-corpus.ts) plays phone items that way when its phone engine is "realtime".
//
// It tries both names the text-only switch has had, `output_modalities` (the GA session shape) and then
// `modalities`, and prints ONE JSON line per variant: {variant, ok, why, seen, text}. `seen` is the event
// types in arrival order, `text` the reply capped at 400 characters, and `why` the outcome, where an OpenAI
// error is its code, type and param only, never its message (a message can echo what was sent). It never
// prints the key, a header or any environment value, and it reads the key from the shell only, never from a
// file. Exit 0 when either variant returned text, 1 when neither did, 2 when there is no key.
//
// It runs in sofia-corpus.yml (step=spike), whose log is public; apps/web/ci/realtime-spike.test.ts pins
// the no-key exit and the no-message rule.
import WebSocket from "ws";
import { buildRealtimeSessionConfig, REALTIME_MODEL } from "../src/lib/voice/session-config";
import { realtimeErrorWhy } from "./realtime-spike-why";

const VARIANTS = ["output_modalities", "modalities"] as const;
type Variant = (typeof VARIANTS)[number];
type SpikeResult = { variant: Variant; ok: boolean; why: string; seen: string[]; text: string };

const TEXT_CAP = 400;
const TIMEOUT_MS = 30_000;

type RealtimeEvent = {
  type?: string; delta?: string;
  error?: unknown;
  response?: { status?: string };
};

function trySession(key: string, variant: Variant): Promise<SpikeResult> {
  return new Promise((resolve) => {
    const cfg = buildRealtimeSessionConfig({
      personaName: "Sofía", businessName: "Spike Test Co", facts: "- Open 9 to 5, Monday to Friday.",
      services: "Testing", languages: "both", bookingEnabled: true, timezone: "America/Chicago",
      slotDurationMinutes: 30, afterHours: "hours_then_message", callerNumber: "+19565550142",
      meetingType: "phone", handoffAvailable: true,
    }, new Date());
    // Text only: no audio block, and the variant's switch set to text.
    const { audio, ...rest } = cfg;
    void audio;
    const session = { ...rest, [variant]: ["text"] };

    const seen: string[] = [];
    let text = "";
    let settled = false;
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
      { headers: { Authorization: `Bearer ${key}` } });
    const finish = (ok: boolean, why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* already closed */ }
      resolve({ variant, ok, why, seen, text: text.slice(0, TEXT_CAP) });
    };
    const timer = setTimeout(() => finish(false, `timeout after ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);

    // A refused upgrade (401, 403, 404…) as its status code only.
    ws.on("unexpected-response", (req, res) => { req.destroy(); finish(false, `http ${res.statusCode ?? "unknown"}`); });
    ws.on("error", (e: Error) => finish(false, `socket error: ${e.name}`));
    ws.on("close", (code: number) => finish(false, `socket closed: ${code}`));
    ws.on("open", () => ws.send(JSON.stringify({ type: "session.update", session })));
    ws.on("message", (raw) => {
      let ev: RealtimeEvent;
      try { ev = JSON.parse(String(raw)) as RealtimeEvent; } catch { seen.push("(unparseable)"); return; }
      const type = typeof ev.type === "string" ? ev.type : "(no type)";
      seen.push(type);
      if (type === "error") {
        finish(false, realtimeErrorWhy(ev.error));
      } else if (type === "session.updated") {
        ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user",
          content: [{ type: "input_text", text: "Hi, what are your hours?" }] } }));
        ws.send(JSON.stringify({ type: "response.create" }));
      } else if (type === "response.output_text.delta") {
        text += ev.delta ?? "";
      } else if (type === "response.done") {
        const status = ev.response?.status ?? "unknown";
        finish(text.trim() !== "", text.trim() ? `text reply received (status ${status})` : `response.done with no text (status ${status})`);
      }
    });
  });
}

async function main(): Promise<void> {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) {
    console.error("OPENAI_API_KEY is not set in this shell (it is never read from a file)");
    process.exit(2);
  }
  let anyText = false;
  for (const variant of VARIANTS) {
    const result = await trySession(key, variant);
    console.log(JSON.stringify(result));
    anyText ||= result.ok;
  }
  process.exit(anyText ? 0 : 1);
}

void main();
