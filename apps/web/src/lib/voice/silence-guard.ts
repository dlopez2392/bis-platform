// Pure decision logic for the silent-call cutoff (spam-screening spec,
// Guard 1). The twin of `call-limits.ts` in shape and for the same reason:
// no socket, no timers, no database here, so the decisions are trivially
// testable and the lifecycle keeps only the wiring.
//
// What this guard exists to stop, in one row: a 247-second call on
// 2026-08-30 whose only two transcript events were four minutes apart and
// both the ASSISTANT's. Nobody ever spoke. It was simultaneously the most
// expensive call in the database and the source of a fabricated summary.

const DEFAULT_SILENT_SECONDS = 30;
const MIN_SILENT_SECONDS = 5;
const MAX_SILENT_SECONDS = 120;

/**
 * How long a call may produce NO caller audio before it is ended.
 *
 * Junk/zero/negative falls back to the default rather than disabling the
 * guard — the same rule `call-limits.ts` uses, for the same reason: a
 * mistyped env var must never silently remove a cost control.
 *
 * The lower clamp is 5s, so a slow greeting has always played before the
 * guard can fire. That floor is NOT what the caller actually gets, though,
 * and this function cannot promise it: the arming site bounds this value to
 * half the cost cap (see below), and for a while that bound sat OUTSIDE this
 * clamp and undercut it — `PHONE_MAX_CALL_SECONDS=1` produced a 0.5s window,
 * and the silent caller was told "I can't hear anything, goodbye" 400ms
 * BEFORE the greeting. The floor survives the bound today only because the
 * cap itself is floored at 10 at that site, making half the cap >= 5 for
 * every legal cap. The effective window is `min(this 5..120 clamp, half the
 * cap)`; both ends of that min are >= 5, so the 5s floor holds.
 *
 * The upper clamp is 120s. That is HALF of `PHONE_MAX_CALL_SECONDS`' 240
 * default — but this function does not, and cannot, guarantee that ordering:
 * it can only see one of the two numbers. An operator tightening the cost cap
 * to 60s while leaving this at 120 inverts them, and on a silent call the CAP
 * would then fire first and hand the model its open-ended "Politely wrap
 * up…" — the exact instruction that produced a fabricated call record on a
 * call where nobody had spoken, and the whole reason the goodbye below is a
 * fixed sentence instead.
 *
 * So the ordering is enforced where BOTH numbers are known: the arming site
 * in `incoming/route.ts` bounds this value to half the resolved cap, and the
 * coupling test in `incoming/lifecycle.test.ts` ("the two cost knobs cannot
 * invert") pins it. What THIS clamp guarantees on its own is only its own
 * range, 5..120.
 */
export function readSilentSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PHONE_MAX_SILENT_SECONDS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SILENT_SECONDS;
  return Math.min(Math.max(Math.floor(n), MIN_SILENT_SECONDS), MAX_SILENT_SECONDS);
}

/**
 * Does this Realtime event mean the CALLER produced audio?
 *
 * Two accepted shapes, deliberately both:
 *
 *  - The whole `input_audio_buffer.` namespace — VAD onset and friends. This
 *    is the FAST signal: it fires the moment the far end makes a sound, so
 *    the timer can never cut off a human who is mid-sentence. Prefix-matched
 *    rather than enumerated because the exact member names belong to the
 *    Realtime API and may change, while everything in that namespace is by
 *    definition about INPUT audio.
 *
 *  - `conversation.item.input_audio_transcription.completed` — the slow
 *    backstop, and the one that carries the correctness argument: it is the
 *    exact event `classifyOutcome` keys `spam` off (`call-state.ts:62`). A
 *    call this function never cancels for is therefore a call the product
 *    would label `spam` anyway. The cutoff and the classification agree by
 *    construction, not by a second heuristic that could drift from the first.
 *
 * Assistant and response events are never caller audio. Sofía talking to
 * herself for four minutes is precisely the failure being stopped.
 *
 * The `typeof` check is not belt-and-braces. `RealtimeCallEvent.type` is
 * DECLARED `string | undefined`, but it is `JSON.parse`d off a socket: a
 * frame is free to carry a number, an object or an array there, and a truthy
 * non-string used to throw out of `.startsWith`. In the lifecycle that throw
 * escaped `handleMessage` and permanently rejected the frame-serialization
 * chain, dropping every remaining frame of the call — no transcript, no lead,
 * no booking — while the caller heard a perfectly normal conversation. A
 * boundary predicate over an untrusted payload answers the question; it does
 * not throw.
 */
export function isCallerAudioEvent(type: string | undefined): boolean {
  if (typeof type !== "string") return false;
  if (type.startsWith("input_audio_buffer.")) return true;
  return type === "conversation.item.input_audio_transcription.completed";
}

/**
 * The line a silent caller hears before the hangup.
 *
 * MUST stay the CONSTRAINED form ("Say exactly...") the greeting uses at
 * `incoming/route.ts:255-258` (`Greet the caller with exactly: ...`). It must
 * NEVER be merged with the cost cap's open-ended "Politely wrap up and say a
 * brief goodbye to the caller — we're out of time"
 * (`incoming/route.ts:337-340`).
 *
 * That is not a style preference. On the 247-second call, the cap's wrap-up
 * instruction was handed to a model that had heard nothing at all, and it
 * answered in the wrong language about an appointment nobody had requested —
 * an invention the summary model then recorded as fact. Asking a model to
 * wrap up a conversation that never happened is asking it to invent one.
 * There is nothing to wrap up on a silent call, so there is nothing to
 * improvise: a fixed sentence, and out.
 *
 * `both` takes English, mirroring the greeting's own rule at
 * `app/api/voice/incoming/route.ts:764` (`languages === "es" ? greeting_es : greeting_en`)
 * rather than inventing a second language policy.
 */
export function silenceGoodbye(languages: "en" | "es" | "both"): string {
  const line = languages === "es"
    ? "Lo siento. No puedo escuchar nada. Por favor llame de nuevo si necesita ayuda. Adiós."
    : "Sorry, I can't hear anything. Please call back if you need us. Goodbye.";
  return `Say exactly this and nothing else: "${line}"`;
}
