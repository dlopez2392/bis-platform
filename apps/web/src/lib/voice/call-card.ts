// apps/web/src/lib/voice/call-card.ts
//
// Every call leaves a card: why they called, the number to call back and the
// caller's own words — and, when the caller wants a person to call them back,
// a To do for that person. `finishCall` is the one caller; this module decides
// what goes on the card and in the To do, and never touches the database.
//
// WHERE EACH FIELD COMES FROM, and why:
//   - reason: what Sofía WROTE DOWN on the call, first — the body of the
//     message she took (`take_message`), else the need on the lead she
//     captured (`capture_lead`). Those are the records she read back to the
//     caller and the ones the staff alert and the call's outcome already
//     stand on; a second, post-call paraphrase must not overrule them. Only a
//     call with neither (a booking, a caller who hung up) takes its reason
//     from the reading below.
//   - callbackNumber: the number recorded with the message or the lead, else
//     the caller ID, through `spokenPhone` — the same rule the lead's own
//     contact write uses: as the caller said it, never re-parsed into a +1
//     that hides whether it was a Mexican number. The model never supplies a
//     number.
//   - callerWords: one caller turn, VERBATIM, chosen by a post-call reading
//     and grounded by `groundedEvidence` — the proposals' rule: never the
//     assistant, never a paraphrase, the caller's whole turn.
//
// WHY A POST-CALL READING and not a new tool on the live call: a tool the
// receptionist has to remember to call adds a turn to a live, latency-
// sensitive call and is never called by the caller who hangs up — the call
// whose "why" an owner most wants. The reading runs after the call row is
// stored, in `finishCall`'s tail beside the proposals, and fails to nothing.
// And not the summary step: that completion is the call's prose record, and
// changing its format to carry a card would let a card fault reach the
// summary.
import type { CallCard, TranscriptEvent } from "@bis/db";
import type { CallState } from "./call-state";
import { classifyOutcome, wasTransferred, callerSpoke } from "./call-state";
import { spokenPhone } from "./phone-number";
import { groundedEvidence } from "@/lib/proposals/grounding";
import { m } from "@/lib/messages";

/** What the post-call reading found. Both null = nothing (no key, a failed
 *  request, or a call that never said why). */
export type CardReading = { reason: string | null; callerWords: string | null };
export const NO_READING: CardReading = { reason: null, callerWords: null };

/** A reason on a To do row and on the calls list is one line. */
const MAX_REASON_LEN = 140;
/** A caller monologue is still their words; past this it is cut, visibly. */
const MAX_WORDS_LEN = 500;

const trimmed = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

/** Cut at the last word boundary under `max` and mark the cut with "…". */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/**
 * What Sofía wrote down: the LAST message's body (a caller who corrects
 * themselves leaves the correction last), else the first lead's need — the
 * same lead `finishCall`'s contact write reads. Null when neither says
 * anything.
 */
export function recordedReason(state: CallState): string | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const body = trimmed(state.messages[i]!.body);
    if (body) return body;
  }
  return trimmed(state.leads[0]?.fields?.need);
}

/**
 * The number to call back: the last message's, else the first lead's, else
 * the caller ID — each through `spokenPhone`, so a number is kept as the
 * caller said it (`take_message` stores `e164Of(said)`, which `spokenPhone`
 * turns back into its ten digits) and the caller ID repeated is the caller
 * ID. Null only when nothing was said and the caller ID was withheld.
 */
export function callbackNumberOf(state: CallState, callerNumber: string | null): string | null {
  const lastMessage = state.messages[state.messages.length - 1];
  const said = trimmed(lastMessage?.callbackNumber) ?? trimmed(state.leads[0]?.fields?.callbackNumber);
  return spokenPhone(said, callerNumber);
}

/**
 * Does a PERSON need to call this caller back?
 *
 *   - A message was taken: `take_message` is "leave a message for a human
 *     callback" by its own contract (tools/schemas.ts), whatever else the
 *     call did — a booked caller can still leave one.
 *   - A lead was captured and nothing was booked (outcome `lead`): someone
 *     has to get back to them. A booked lead's appointment IS the follow-up.
 *
 * Never for a RECORDING: `classifyOutcome` deliberately lets a message
 * outrank the robocall marker, so a robot that talked Sofía into taking a
 * message classifies `message` — `recordedCaller` is the repo's own
 * robocall flag and is checked here directly. And never for a caller who
 * asked for a person: either a person took the call, or the transfer rang
 * out and its own route (`texml/handoff-result`) decides what that caller
 * gets; a To do here would sit beside a conversation the transcript cannot
 * see (the proposals' `handoffRequested` rule).
 *
 * The caller who hung up having left nothing is not here: there is no
 * request to act on, and the missed-call text-back is that caller's path.
 */
export function callbackWanted(state: CallState): boolean {
  if (state.recordedCaller || wasTransferred(state)) return false;
  return state.messages.length > 0 || classifyOutcome(state) === "lead";
}

/**
 * The To do's title, in English: tasks.title is stored text and every To do
 * surface renders it verbatim; the `.es` twin waits for an operator locale
 * (the consent To do's precedent). Replacer FUNCTIONS, never strings: a
 * reason is the caller's request in the model's words and may carry `$&`.
 */
export function callbackTaskTitle(number: string, reason: string | null): string {
  const why = trimmed(reason);
  if (!why) return m["todo.callback.bare.en"].replace("{number}", () => number);
  return m["todo.callback.en"]
    .replace("{number}", () => number)
    .replace("{reason}", () => clamp(why, MAX_REASON_LEN));
}

/**
 * Is the transcript worth a reading? Only when the CALLER said something
 * (a silent ring has nothing to quote) and the call was not a robocall —
 * the summary's own reason for skipping spam applies: a model handed an
 * empty transcript has invented a reason before.
 */
export function cardReadable(state: CallState): boolean {
  return !state.recordedCaller && classifyOutcome(state) !== "spam" && callerSpoke(state);
}

/** Seven or more digits in a run (spaces, dots, dashes, brackets between):
 *  a phone number. The card's number comes from the call, never from prose. */
const PHONE_LIKE = /\d(?:[\s().-]*\d){6,}/;

const SYSTEM = [
  "You read a finished phone call to a small business and fill in a card the owner reads in three seconds.",
  'Reply ONLY with JSON: {"reason": "...", "quote": "..."}.',
  "reason: why the caller called, in plain everyday English, at most 12 words, the way an owner jots it on a sticky note (for example \"Wants a quote for a roof leak\").",
  "Never put a name, a phone number, an email address or a time in reason, and never invent anything the caller did not say.",
  "If the caller never said why they called, reason is null.",
  "quote: the caller's OWN words, copied VERBATIM from ONE caller line of the transcript, where they say why they called. Never quote the assistant. Never paraphrase. If there is no such line, quote is null.",
  "Write reason in English even when the call was in Spanish; quote stays in the language the caller spoke.",
].join(" ");

/**
 * The post-call reading: a one-line reason and the caller turn that says it.
 *
 * NEVER THROWS, and that is what `finishCall` relies on: a missing key, a
 * refused or hung request (10 s, the summary's bound), unparseable content
 * and an ungrounded quote all come back as nothing, and the card falls back
 * to what was written down on the call.
 */
export async function readCallForCard(
  transcript: TranscriptEvent[],
  opts: { fetchImpl?: typeof fetch; label?: string } = {},
): Promise<CardReading> {
  const label = opts.label ?? "readCallForCard";
  try {
    // Read inside the body, never at module scope (summary-service.ts's
    // rule): a missing key at build time must not break the import.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(`${label}: OPENAI_API_KEY not set, no reading for the call card`);
      return NO_READING;
    }
    const fetchImpl = opts.fetchImpl ?? fetch;
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // JSON mode: generate.ts's reason — without it the model routinely
        // wraps JSON in a code fence, and this parse has no fallback of its
        // own beyond "nothing".
        response_format: { type: "json_object" },
        max_tokens: 300,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: transcript.map((e) => `${e.role}: ${e.text}`).join("\n") },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error(`${label}: model request failed: HTTP ${r.status}`);
      return NO_READING;
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return NO_READING;
    const parsed = JSON.parse(content) as { reason?: unknown; quote?: unknown } | null;

    let reason = trimmed(parsed?.reason);
    if (reason && PHONE_LIKE.test(reason)) reason = null;
    const quote = trimmed(parsed?.quote);
    const turn = quote ? groundedEvidence(quote, transcript) : null;
    const words = turn ? trimmed(turn) : null;
    return {
      reason: reason ? clamp(reason, MAX_REASON_LEN) : null,
      callerWords: words ? clamp(words, MAX_WORDS_LEN) : null,
    };
  } catch (e) {
    console.error(`${label}: reading failed: ${String(e)}`);
    return NO_READING;
  }
}

/**
 * The card as stored. Null — no card at all — for a spam call (a robocall,
 * or a call where nobody spoke), and for a call that left nothing to show.
 */
export function composeCallCard(
  state: CallState, callerNumber: string | null, reading: CardReading,
): CallCard | null {
  if (state.recordedCaller || classifyOutcome(state) === "spam") return null;
  const card: CallCard = {
    reason: recordedReason(state) ?? reading.reason,
    callbackNumber: callbackNumberOf(state, callerNumber),
    callerWords: reading.callerWords,
  };
  return card.reason || card.callbackNumber || card.callerWords ? card : null;
}
