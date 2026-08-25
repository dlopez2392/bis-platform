// Ported verbatim from the reception demo (its tuning history is the value):
// server_vad@500ms interrupted callers → semantic/low paused too long →
// semantic/medium is the setting danlo judged right on real calls. Env knobs
// exist so the feel costs a redeploy, not a code change.
export type Eagerness = "low" | "medium" | "high" | "auto";

export type TurnDetection =
  | { type: "semantic_vad"; eagerness: Eagerness; create_response: true; interrupt_response: true }
  | {
      type: "server_vad"; threshold: number; prefix_padding_ms: number;
      silence_duration_ms: number; create_response: true; interrupt_response: true;
    };

const EAGERNESS: Eagerness[] = ["low", "medium", "high", "auto"];
const DEFAULTS = { eagerness: "medium" as Eagerness, silenceMs: 800, thresholdRaw: 0.6, prefixPaddingMs: 300 };

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readTurnDetection(env: NodeJS.ProcessEnv = process.env): TurnDetection {
  const mode = (env.PHONE_TURN_DETECTION ?? "").trim().toLowerCase();
  if (mode === "server") {
    return {
      type: "server_vad",
      threshold: num(env.PHONE_VAD_THRESHOLD, DEFAULTS.thresholdRaw, 0, 1),
      prefix_padding_ms: num(env.PHONE_VAD_PREFIX_PADDING_MS, DEFAULTS.prefixPaddingMs, 0, 2000),
      silence_duration_ms: num(env.PHONE_VAD_SILENCE_MS, DEFAULTS.silenceMs, 200, 4000),
      create_response: true, interrupt_response: true,
    };
  }
  const raw = (env.PHONE_VAD_EAGERNESS ?? "").trim().toLowerCase() as Eagerness;
  return {
    type: "semantic_vad",
    eagerness: EAGERNESS.includes(raw) ? raw : DEFAULTS.eagerness,
    create_response: true, interrupt_response: true,
  };
}
