// OpenAI Realtime-SIP webhook target (platform.openai.com > Settings >
// Webhooks, event `realtime.call.incoming`). This route and `/api/voice/texml`
// are the ONLY two voice entry points: Telnyx hits texml first, which bridges
// the call to OpenAI's SIP connector with the dialed number smuggled onto the
// SIP URI as `X-BIS-Called`; OpenAI then calls back HERE with that number in
// `sip_headers`, and this route is what resolves it to a tenant, decides
// whether to answer, and — if so — accepts the call and keeps it alive for
// its whole duration.
//
// Runs on the Node.js runtime (the `ws` package and the signature
// verification's `crypto.subtle` usage are not Edge-compatible), with a
// generous `maxDuration` because the call-scoped WebSocket loop in
// `runCallLifecycle` runs for the entire phone call, not just this request.
// 800 is the ceiling, not a guess. Vercel's "Duration limits" table
// (/docs/functions/configuring-functions/duration) reads: Hobby 300s
// default / 300s maximum; Pro 300s default / 800s maximum, with a 1800s
// "extended maximum". This account is on Pro, so 800s is the generally
// available maximum and is what this route takes. The 1800s tier is a beta
// requiring per-function configuration and is deliberately NOT used. Note
// the PROJECT default stays 300s — this per-route export is the only thing
// raising it, and only for this function.
//
// This route previously exported 300 because that was Hobby's maximum, not
// because 300s was ever the right length for a phone call. Raising it moves
// only the roof: the call length a caller actually experiences is set by
// `PHONE_MAX_CALL_SECONDS` (default 240s), which is a COST guardrail and is
// deliberately unchanged. See the cap block in `runCallLifecycle` below.
//
// Three contracts worth stating up front, because getting any of them wrong
// fails SILENTLY (dead air or a rejected accept, not a thrown error):
//
//  1. FLAT accept body. `POST /v1/realtime/calls/{call_id}/accept` takes the
//     same flat session-create shape `buildRealtimeSessionConfig` already
//     returns (type/model/instructions/tools/audio at the top level) — NOT
//     nested under a `session` key. Nesting it is the documented way to get
//     a silent 4xx.
//
//  2. Accepting returns once the SIP leg is RINGING, not once media is
//     flowing. Sending the greeting immediately clips its first syllable —
//     that's why `runCallLifecycle` delays it by `PHONE_GREETING_DELAY_MS`
//     (default 900ms) rather than firing it the instant the socket opens.
//
//  3. Fail-open, deliberately, in exactly three places. This list is what a
//     future auditor checks the code against, so it is kept exhaustive on
//     purpose — a site missing from it reads as a bug to be "hardened":
//
//       - The call-cap and caller-reputation counts (step 8 below) — a DB
//         blip must not turn away a real caller; losing a prospect costs
//         more than paying for one extra robocall.
//       - `startCallRow` (step 10) — a DB blip must not lose the call
//         itself; `finishCall` already tolerates a null `callRowId` and
//         still gets the staff alert out.
//       - The silence-guard cancel check inside `handleMessage` (added with
//         Guard 1) — a predicate throwing on an untrusted frame DISARMS the
//         guard rather than leaving it armed, so the call degrades to
//         exactly the pre-guard behaviour and runs to the cost cap. A bug in
//         a cost optimisation must never cut off a paying customer.
//
//     Signature verification and account resolution are NOT fail-open —
//     those gate who gets to talk to a tenant's AI at all.
//
// Every branch past the initial config/signature checks acks the webhook
// with 200, `declined` or not: OpenAI's incoming-call webhook is not usefully
// retried, and simply never accepting the call IS how a decline is expressed.
// A stray 5xx here would only obscure the real failure, which is always
// visible in the `[voice/incoming]` log line at the point it happened.
import { NextRequest, NextResponse, after } from "next/server";
import OpenAI from "openai";
import WebSocket from "ws";
import {
  serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince, countCallsByCallerSince,
  countCallerHistorySince, startCallRow, getOrCreateCalendar, deleteCallRow,
  getTransferPhone, listPhoneNumbersForAccount,
  type Branding,
} from "@bis/db";
import {
  extractCallerNumber, extractCalledNumber, extractHandoffToken, sipHeaderNames,
} from "@/lib/voice/sip-headers";
import { resolveHandoffTarget, type HandoffTarget } from "@/lib/voice/handoff";
import { callAnswerable } from "@/lib/voice/accept-gate";
import { buildRealtimeSessionConfig, type VoicePromptInput } from "@/lib/voice/session-config";
import { processCallEvent, type RealtimeCallEvent } from "@/lib/voice/call-events";
import { emptyCallState } from "@/lib/voice/call-state";
import { finishCall, type FinishContext } from "@/lib/voice/finish-call";
import type { ToolContext } from "@/lib/voice/tools/registry";
import { readLimitConfig, decideLimit, utcDayStart } from "@/lib/voice/call-limits";
import { readReputationConfig, decideReputation, windowStart } from "@/lib/voice/caller-reputation";
import { readSilentSeconds, isCallerAudioEvent, silenceGoodbye } from "@/lib/voice/silence-guard";
import { configuredOrigin } from "@/lib/email/origin";
import { brandDisplayName } from "@/lib/email/templates/shell";

export const runtime = "nodejs";
export const maxDuration = 800;

function log(...args: unknown[]) {
  console.log("[voice/incoming]", ...args);
}

// The `ACCOUNT_BRAND_COLS` shape from `packages/db/src/booking.ts:286` is not
// exported — that accessor is `listDueReminders`'s private implementation
// detail, not a public seam — so the identical column list is selected
// inline here rather than reaching into the package's internals.
const ACCOUNT_COLS =
  "timezone, brand_name, brand_logo_path, brand_color, brand_neutral, " +
  "brand_corners, brand_type, brand_mode, reply_to_email, from_email";

type AccountBrandRow = {
  timezone: string;
  brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
  brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
  brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
  reply_to_email: string | null; from_email: string | null;
};

async function loadAccountContext(
  db: ReturnType<typeof serviceDb>, accountId: string,
): Promise<AccountBrandRow> {
  const { data, error } = await db.from("accounts").select(ACCOUNT_COLS).eq("id", accountId).single();
  if (error || !data) {
    throw new Error(`voice/incoming: account lookup failed for ${accountId}: ${error?.message}`);
  }
  return data as unknown as AccountBrandRow;
}

// Accept endpoint per OpenAI's realtime-SIP guide: POST
// /v1/realtime/calls/{call_id}/accept, Bearer auth, flat session body (see
// contract #1 above). Throws on any non-ok response or network failure; the
// caller decides what "failed to accept" means for the webhook response.
async function acceptCall(callId: string, apiKey: string, sessionConfig: object): Promise<void> {
  const res = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(sessionConfig),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`accept failed: ${res.status} ${detail}`);
  }
}

/**
 * How long a last sentence gets to reach the caller before the socket goes.
 *
 * ONE constant for all three endings — the cost cap's goodbye, the silence
 * guard's, and the handoff line — because they are the same physical problem:
 * `ws.send` only queues the instruction, and closing the socket while the
 * model is still generating audio cuts the caller off mid-word. The cap's
 * tail budget (see `maxSeconds` below) is derived from this number, so a
 * second copy of it somewhere else would silently break that derivation.
 */
const CLOSE_AFTER_GOODBYE_MS = 5000;

interface LifecycleArgs {
  callId: string;
  apiKey: string;
  greeting: string;
  languages: "en" | "es" | "both";
  callRowId: string | null;
  startedAt: Date;
  toolCtx: ToolContext;
  finishCtx: FinishContext;
}

/**
 * The call-scoped WebSocket loop — lives for the entire phone call, run in
 * the background via `after()` so it never delays the webhook's own 200.
 * State is a local `let`, in-process, no store: one call, one invocation,
 * dies with it (mirrors `call-state.ts`'s own doc comment).
 *
 * Ported shape from the reception demo's `runCallLifecycle`, re-pointed at
 * this platform's tested seams (`processCallEvent`, `finishCall`) in place
 * of the demo's own recorder/store.
 */
function runCallLifecycle(args: LifecycleArgs): Promise<void> {
  const { callId, apiKey, greeting, languages, callRowId, startedAt, toolCtx, finishCtx } = args;
  let state = emptyCallState();
  let capTimer: NodeJS.Timeout | undefined;
  let closeTimer: NodeJS.Timeout | undefined;
  let greetTimer: NodeJS.Timeout | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  let silenceTimer: NodeJS.Timeout | undefined;
  let settled = false;

  // `callId` is server-controlled (OpenAI's own webhook payload, not a form
  // field), but it still lands raw in a URL query string here — the same
  // encodeURIComponent the accept endpoint above already applies, for the
  // same reason: nothing guarantees its charset, and the tests exercise a
  // callId with `/` and `?` in it.
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return new Promise<void>((resolve) => {
    // Idempotent: `close` and `error` can both fire for the same socket, and
    // this must run exactly once regardless of which (or both) arrive.
    const finish = async (reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(capTimer);
      clearTimeout(closeTimer);
      clearTimeout(greetTimer);
      clearTimeout(connectTimer);
      clearTimeout(silenceTimer);

      // Drain in-flight frames, but bounded: a wedged frame must not block
      // the record forever (losing the row is worse than a slightly stale
      // state). Without this, a frame mid-flight when the caller hangs up
      // (e.g. a ~1s book_appointment tool call) is lost outright — `finish`
      // used to read `state` immediately on `close`/`error`, so the call
      // would record as `abandoned` (no staff alert, no bookingId) even
      // though the booking landed a moment later. `state` below is read
      // AFTER this drain, not before it, so that frame's effect survives.
      await Promise.race([chain, new Promise((r) => setTimeout(r, 3000))]).catch(() => {});

      log("call ended", { callId, reason });

      // Honesty note: when `reason` is "connect-timeout", `state` is still
      // the pristine `emptyCallState()` — the WS never opened, so nothing
      // was ever mirrored into it — so `classifyOutcome` (inside
      // `finishCall`, see call-state.ts) reads this as outcome "spam" with
      // `turn_count: 0`. That combination is the only signal this call ever
      // existed at all; read it as "never connected", not literal abuse.
      // Deliberately not a dedicated outcome value: `calls.outcome` carries
      // a check constraint already applied in production, and widening it
      // for one log-reading nuance isn't worth a migration.
      //
      // finishCall is documented never-throws; this catch is belt-and-
      // suspenders against that contract changing out from under this route.
      try {
        await finishCall(state, finishCtx, { callRowId, startedAt, endedAt: new Date() });
      } catch (e) {
        log("finishCall threw unexpectedly", { callId, error: String(e) });
      }
      resolve();
    };

    // Connect timeout: OpenAI's SIP `accept` can return 200 (the leg is
    // RINGING — contract #2 in the file header) and the media socket can
    // still never come up (bad network, a stalled SIP leg). Without this, a
    // call that never opens hangs the `after()` background invocation for
    // the full route `maxDuration` with nobody ever getting a `finishCall` —
    // dead air for the caller AND the platform never learning the call
    // happened at all. Cleared the moment `open` actually fires.
    const connectRaw = Number(process.env.PHONE_CONNECT_TIMEOUT_MS);
    const connectTimeoutMs = Number.isFinite(connectRaw)
      ? Math.min(Math.max(connectRaw, 1000), 60000)
      : 15000;
    connectTimer = setTimeout(() => {
      log("call socket did not open in time — terminating", { callId, connectTimeoutMs });
      ws.terminate();
      void finish("connect-timeout");
    }, connectTimeoutMs);

    ws.on("open", () => {
      // `open` can race in AFTER a connect timeout already fired and settled
      // the call (dead socket, `finishCall` already ran) — arming the
      // greeting/cap timers on it would send audio into a socket nobody is
      // listening to and double up the timer bookkeeping this `finish` call
      // already tore down.
      if (settled) return;
      clearTimeout(connectTimer);
      log("call socket open", { callId });

      // Delayed on purpose (contract #2 above): accepting a SIP call returns
      // 200 once the leg is RINGING, not once media is flowing, so audio
      // sent immediately can clip. Tunable via PHONE_GREETING_DELAY_MS.
      const delayRaw = Number(process.env.PHONE_GREETING_DELAY_MS);
      const greetingDelayMs = Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 900;
      greetTimer = setTimeout(() => {
        try {
          ws.send(JSON.stringify({
            type: "response.create",
            response: { instructions: `Greet the caller with exactly: ${greeting}` },
          }));
        } catch (e) {
          log("greeting send failed", { callId, error: String(e) });
        }
      }, greetingDelayMs);

      // Cost guardrail: hard cap on call length. On fire, ask the model for
      // a brief goodbye, then close the socket ~5s later to let it play out.
      const capRaw = Number(process.env.PHONE_MAX_CALL_SECONDS);
      const parsedOrDefault = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 240;
      // The default stays 240s ON PURPOSE. Pro raising `maxDuration` to 800s
      // (module top) raised the ROOF, not the furniture: every second of a
      // Realtime call is billed audio, so a longer ceiling must not silently
      // make every call longer and every call more expensive. Lengthening
      // real calls is an explicit `PHONE_MAX_CALL_SECONDS` decision, not a
      // side effect of a plan upgrade.
      //
      // The clamp is what keeps the cap from eating the invocation. The cap
      // timer is armed HERE, in `ws.on("open")` — not when the request
      // arrived — so the budget has two halves, and an earlier version of
      // this derivation only counted one of them.
      //
      // AFTER the cap fires (the tail). Everything below has to finish inside
      // `maxDuration` or Fluid Compute kills the invocation mid-teardown and
      // the call row is lost:
      //
      //     5s  closeTimer — the goodbye plays out before `ws.close()`
      //     3s  finish()'s bounded frame drain (`Promise.race([chain, 3000])`)
      //    10s  finishCall's carrier text-back send (SEND_TIMEOUT_MS,
      //         `lib/sms/telnyx.ts`) — a full provider round trip
      //    12s  the rest of finishCall: contact, conversation and message
      //         rows, `finishCallRow`, and the staff alert email — sequential
      //         network round trips with no timeout of their own
      //    ---
      //    30s  worst-case tail
      //
      // BEFORE the cap timer is armed (the connect leg). This is real elapsed
      // `maxDuration` that the cap knows nothing about, because the clock the
      // platform is measuring started at the webhook and the cap's own clock
      // starts here:
      //
      //     ~5s  cold start, signature verification, account resolution and
      //          the `accept` round trip to OpenAI
      //     15s  the wait for the media socket to open — bounded by
      //          PHONE_CONNECT_TIMEOUT_MS, whose DEFAULT is 15000ms. The
      //          worst case that still reaches this line is a connect that
      //          took just under that; a connect that exceeds it never arms
      //          the cap at all (`settled` short-circuits above).
      //    ----
      //     20s  worst-case connect leg
      //
      //   800 - 30 - 20 = 750
      //
      // Tightened from 770, which budgeted the tail only. 770 + 30 + 20 = 820
      // overruns the 800s ceiling by 20s. Unreachable today — the default cap
      // is 240s and nothing approaches the clamp — but it is the same latent
      // shape the old 280/300 pair had, and it is cheaper to fix than to
      // remember.
      //
      // THE ASSUMPTION THIS STILL CARRIES: PHONE_CONNECT_TIMEOUT_MS is
      // configurable up to 60000ms (clamped above). Raising it past ~35s eats
      // the whole connect budget and this 750 must be re-derived. Nothing
      // enforces that coupling — the two knobs are independent, and this
      // comment is the only thing linking them.
      //
      // THE FLOOR OF 10 IS THE SILENCE WINDOW'S, NOT THE CAP'S. A 1s cost cap
      // is absurd but harmless on its own. What it was not harmless to is the
      // silence window below, which is bounded at HALF this number: half of
      // anything under 10 lands beneath `readSilentSeconds`' own 5s floor, and
      // measured off that guard's log line a cap of 8 armed a 4s window and a
      // cap of 1 armed 0.5s — the silent caller heard "I can't hear anything,
      // goodbye" 400ms BEFORE the 900ms greeting reached them. Flooring the
      // CAP is what makes the half-bound incapable of undercutting the clamp
      // it is applied to. Flooring after the min instead would let the window
      // TIE the cap, and a tie fires the cap first (insertion order).
      const maxSeconds = Math.min(Math.max(parsedOrDefault, 10), 750);
      capTimer = setTimeout(() => {
        log("call cap reached, sending goodbye", { callId, maxSeconds });
        try {
          ws.send(JSON.stringify({
            type: "response.create",
            response: { instructions: "Politely wrap up and say a brief goodbye to the caller — we're out of time." },
          }));
        } catch {
          // socket may already be closing; the closeTimer below still fires.
        }
        closeTimer = setTimeout(() => {
          log("closing call socket after cap goodbye", { callId });
          ws.close();
        }, CLOSE_AFTER_GOODBYE_MS);
      }, maxSeconds * 1000);

      // Cost guardrail #2: the cap above bounds a call that is going
      // somewhere. This one bounds a call that is not. A robot that connects
      // and says nothing used to bill the full `maxSeconds` — see the
      // 247-second call in the spec, whose only two transcript events were
      // four minutes apart and both Sofía's.
      //
      // Armed here rather than after the greeting for the same reason
      // `capTimer` is: one timer, one origin, no second lifecycle concept to
      // keep in sync.
      //
      // THE ARMED WINDOW IS `min(readSilentSeconds() clamped 5..120, half the
      // cap)` — NOT the module's clamp alone. Both ends of that min are >= 5,
      // so a slow greeting is safe, but only because `maxSeconds` above is
      // floored at 10. That floor is load-bearing for this line and exists for
      // it; the two must move together or the half-bound starts undercutting
      // the clamp again, which is exactly what it used to do.
      //
      // THE ORDERING IS ENFORCED HERE, NOT DESCRIBED. The two knobs are
      // independent in the environment: PHONE_MAX_SILENT_SECONDS clamps to
      // 5–120 and PHONE_MAX_CALL_SECONDS to <=750, so `120` and `60` is a
      // legal pair an operator can reach by two individually sensible edits.
      // Under it, on a call where nobody speaks, the CAP fires first and
      // hands the model the open-ended "Politely wrap up…" below — which is
      // precisely how the 247-second call produced a fabricated summary, and
      // the whole reason this guard carries its own fixed sentence instead.
      //
      // So the window is bounded against the already-resolved `maxSeconds`
      // rather than trusted: HALF the cap. Half, not "cap minus something",
      // because half is strictly less than the cap for every positive
      // `maxSeconds` and therefore can never TIE it — and a tie would fire
      // the cap first, since `capTimer` was scheduled a few lines earlier and
      // same-deadline timers run in insertion order. A silent call may spend
      // at most half the cost budget.
      //
      // This is the enforcement PHONE_CONNECT_TIMEOUT_MS's block above still
      // lacks and says so ("nothing enforces that coupling"). Pinned by the
      // coupling test in `lifecycle.test.ts` — "the two cost knobs cannot
      // invert" — in the shape `automations/cron-coupling.test.ts` uses for
      // the cron/window pair.
      const silentSeconds = Math.min(readSilentSeconds(), maxSeconds / 2);
      silenceTimer = setTimeout(() => {
        // Belt to `finish()`'s own `clearTimeout(silenceTimer)`, matching the
        // guard `ws.on("open")` and `ws.on("message")` already carry: if a
        // future edit drops that clear, this leaks inert instead of sending a
        // goodbye into a socket that was torn down when the caller hung up.
        if (settled) return;
        // Disarmed BEFORE anything else, so the cancel branch in
        // `handleMessage` cannot log "silence guard cleared" for a guard that
        // has already fired. That log line is the diagnostic an operator
        // reads off a real call; a call where it appears AND the call ends
        // five seconds later would be unreadable.
        //
        // Late caller audio therefore does NOT cancel the pending close, on
        // purpose: once the fixed goodbye is playing the call is ending, and
        // a caller speaking over it must not resurrect the session.
        silenceTimer = undefined;
        // The call is over — the cost cap has nothing left to bound. The
        // bound above ORDERS the two timers; this makes the cap unreachable
        // outright, including the degenerate configurations where the cap
        // would land inside the 5s goodbye playout below.
        clearTimeout(capTimer);
        log("no caller audio, ending call", { callId, silentSeconds });
        try {
          ws.send(JSON.stringify({
            type: "response.create",
            response: { instructions: silenceGoodbye(languages) },
          }));
        } catch {
          // socket may already be closing; the closeTimer below still fires.
        }
        closeTimer = setTimeout(() => {
          log("closing call socket after silence goodbye", { callId });
          ws.close();
        }, CLOSE_AFTER_GOODBYE_MS);
      }, silentSeconds * 1000);
    });

    // Serialized on purpose. `ws` never awaits its own event handlers — an
    // `async (raw) => ...` listener directly on `.on("message", ...)` lets
    // overlapping frames interleave: frame B's `processCallEvent` can finish
    // and do `state = result.state` while frame A's is still awaiting a slow
    // tool call, and when A finally resolves it does the SAME plain
    // read-modify-write, computed from the `state` variable as it was
    // BEFORE B ever landed — silently discarding whatever B did (a
    // transcript line, a `contactId`, a booking mirror). This is the exact
    // race class the reception demo's own lesson log calls out for any WS
    // handler that reads then writes shared state across an `await`.
    //
    // Chaining every frame onto a running promise makes each one wait for
    // the previous frame's full effects (the state write AND its outbound
    // `ws.send`s) before it starts, restoring arrival order without
    // blocking the event loop between frames — and because the listener
    // itself never throws (the try/catch inside `handleMessage` swallows
    // per-frame failures and logs them), the chain can never get stuck
    // permanently rejected.
    //
    // That last clause is an INVARIANT `handleMessage` has to keep, not a
    // fact about it: every statement in it that touches the parsed payload
    // belongs inside its try. A single statement placed outside one (the
    // silence-guard cancel, briefly) is enough to reject this chain forever
    // and silently drop the rest of the call.
    let chain: Promise<void> = Promise.resolve();
    ws.on("message", (raw) => {
      // Post-drain frames must not mutate recorded state or attempt sends on
      // a torn-down socket: `finish()` has already read `state` (past the
      // bounded drain above) and handed it to `finishCall` by the time
      // `settled` flips, so anything arriving after that point is too late
      // to matter and only risks `ws.send`ing into a socket nobody is
      // listening to.
      if (settled) return;
      chain = chain.then(() => handleMessage(raw));
    });

    async function handleMessage(raw: WebSocket.RawData): Promise<void> {
      let event: RealtimeCallEvent;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        log("failed to parse call event", { callId });
        return;
      }
      try {
        // Cancelled here — INSIDE this try, and still before
        // `processCallEvent`, so a throw inside tool handling can never leave
        // the guard armed on a call where the caller is plainly talking. One
        // sound is enough and it is permanent: this guard asks "did anyone
        // ever speak", which is exactly the question `classifyOutcome` asks
        // to decide `spam`, so it is never re-armed.
        //
        // INSIDE the try is load-bearing, not tidiness. This function's
        // promise is chained onto `chain` above; anything that escapes it
        // rejects that chain PERMANENTLY, and every later frame of the call
        // is then dropped — no transcript, no lead, no booking, no tool call
        // — while the caller hears a normal conversation, because the audio
        // is OpenAI's SIP bridge and not ours. `event.type` is DECLARED a
        // string and is in fact whatever the socket sent; the same will be
        // true of every field the predicates added alongside this one read.
        //
        // It also rides the serialization chain like any other frame, so a
        // frame still awaiting a slow tool call ahead of it delays this
        // cancel by however long that tool takes, and the guard can fire
        // inside that window. Accepted: reading the cancel off the raw socket
        // ahead of the chain would reintroduce the exact ordering race the
        // chain exists to remove, and a call with a tool call in flight is by
        // definition a call where someone already spoke — so an earlier frame
        // has already cancelled the guard.
        //
        // The INNER try is not redundant with the outer one. Sharing the
        // outer catch would stop the chain rejecting, but a predicate that
        // throws on one frame's payload throws on the next one too — and
        // every throw would skip that frame's `processCallEvent`, losing the
        // whole call's transcript, leads and bookings just as completely as
        // the wedged chain did, only more quietly. A predicate over an
        // untrusted field must cost AT MOST the guard it decides, never the
        // call it was watching.
        try {
          if (silenceTimer && isCallerAudioEvent(event?.type)) {
            clearTimeout(silenceTimer);
            silenceTimer = undefined;
            log("caller audio detected, silence guard cleared", { callId, type: event?.type });
          }
        } catch (e) {
          // FAIL OPEN, like every other decision in this feature: the guard is
          // DISARMED on a throw, never left armed.
          //
          // Leaving it armed was the one branch here that failed the other
          // way, and a probe showed what that costs — a throwing predicate ran
          // to the 30s mark on a caller who had produced a VAD onset AND said
          // "hello, I need a roof repair", and the socket closed on them at
          // 35s. A bug in a COST OPTIMISATION must never cut off a paying
          // customer, and must never leave the product worse than it was
          // before the optimisation existed. Losing a prospect costs more than
          // paying for one extra robocall.
          //
          // `capTimer` is deliberately LEFT ALONE, so the call degrades to
          // exactly the pre-Guard-1 behaviour: it runs to the cost cap, as
          // every call did before this timer existed. Disarming the guard is a
          // retreat to the old bound, not a removal of all bounds.
          //
          // Still logged rather than swallowed: this line is what explains a
          // call that billed the full cap on a day the guard was supposed to
          // be shortening silent ones.
          clearTimeout(silenceTimer);
          silenceTimer = undefined;
          log("silence guard cancel check threw — guard disarmed, call runs to the cost cap", { callId, error: String(e) });
        }
        const result = await processCallEvent(state, toolCtx, event);
        state = result.state;
        for (const action of result.actions) {
          if (action.kind === "send") {
            ws.send(JSON.stringify(action.payload));
            continue;
          }
          // `close` — the caller asked for a person and the intent is already
          // written (`transfer_to_human` awaited that before returning). The
          // send above it queued the handoff sentence; the SAME playout delay
          // the cap and the silence guard use lets it reach the caller before
          // the socket goes. Closing here, synchronously, would be dead air
          // followed by a ring.
          //
          // The two cost timers are cleared for the same reason the silence
          // guard clears the cap: this call is ending on its own terms, and a
          // goodbye sent over the handoff line — or a second closeTimer
          // overwriting this one — would be a stranger's voice on top of it.
          log("transfer requested, closing the AI leg", { callId });
          clearTimeout(capTimer);
          clearTimeout(silenceTimer);
          silenceTimer = undefined;
          closeTimer = setTimeout(() => {
            log("closing call socket after handoff line", { callId });
            ws.close();
          }, CLOSE_AFTER_GOODBYE_MS);
        }
      } catch (e) {
        log("error processing call event", { callId, type: event?.type, error: String(e) });
      }
    }

    ws.on("close", (code, reason) => {
      void finish(`ws-close:${code}:${reason?.toString() ?? ""}`);
    });

    ws.on("error", (err) => {
      log("call socket error", { callId, error: String(err) });
      void finish("ws-error");
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Step 1: server configuration -----------------------------------
  const secret = process.env.OPENAI_WEBHOOK_SECRET;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!secret || !apiKey) {
    log("missing OPENAI_WEBHOOK_SECRET or OPENAI_API_KEY — refusing to run open");
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  // --- Step 2: signature verification ----------------------------------
  // req.text() FIRST — unwrap needs the exact raw bytes the signature was
  // computed over; re-serializing a parsed body would not match.
  const rawBody = await req.text();
  const client = new OpenAI({ apiKey });

  let event: OpenAI.Webhooks.UnwrapWebhookEvent;
  try {
    event = await client.webhooks.unwrap(rawBody, req.headers, secret);
  } catch (e) {
    log("webhook signature verification failed", { error: String(e) });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Everything past this point acks 200 no matter what happens inside — see
  // the file header's "never a stray 5xx" note. An unexpected throw anywhere
  // below (an account row that violates its own FK integrity, say) logs and
  // falls through to the same ok:true a graceful decline would return.
  try {
    // --- Step 3: only handle the incoming-call event ---------------------
    if (event.type !== "realtime.call.incoming") {
      log("ignoring non-call webhook event", { type: event.type });
      return NextResponse.json({ ok: true });
    }

    const now = new Date();

    // --- Step 4: extract routing info, log NAMES never VALUES ------------
    const callId = event.data.call_id;
    const callerNumber = extractCallerNumber(event.data);
    const calledNumber = extractCalledNumber(event.data);
    log("incoming call", { callId, callerNumber, calledNumber, sipHeaderNames: sipHeaderNames(event.data) });

    // --- Step 5: unroutable ------------------------------------------------
    if (!calledNumber) {
      log("declined: unroutable — no called number on the SIP headers", { callId });
      return NextResponse.json({ ok: true, declined: "unroutable" });
    }

    // --- Step 6: resolve the tenant off the dialed number -----------------
    const db = serviceDb();
    const phoneRow = await getPhoneNumberByE164(db, calledNumber);
    if (!phoneRow || (phoneRow.status !== "testing" && phoneRow.status !== "live")) {
      log("declined: unknown-number", { callId, calledNumber });
      return NextResponse.json({ ok: true, declined: "unknown-number" });
    }
    const accountId = phoneRow.account_id;

    // --- Step 7: the tenant's voice profile must exist and, for a live
    // number, be enabled — a testing number answers regardless of the
    // toggle (shared gate predicate, stays in agreement with texml's) ------
    const profile = await getVoiceProfile(db, accountId);
    const gate = callAnswerable({ status: phoneRow.status, profile });
    if (!gate.answerable) {
      log("declined: disabled", { callId, accountId });
      return NextResponse.json({ ok: true, declined: "disabled" });
    }
    // Unreachable — callAnswerable's "no-profile" reason above already
    // returned for a null profile — but TypeScript can't see across that
    // predicate call, so this narrows `profile` for everything below.
    if (!profile) {
      return NextResponse.json({ ok: true, declined: "disabled" });
    }

    // --- Step 8: abuse caps + caller reputation, fail-open on a counting
    // failure ---------------------------------------------------------------
    // Reputation is the SAME predicate the TeXML route speaks its refusal
    // from (`caller-reputation.ts`), enforced here. TeXML is the UX layer and
    // gives the caller words; this is the layer that makes the decision
    // binding — exactly the split `callAnswerable` already documents, and the
    // reason the OpenAI SIP endpoint being reachable by anyone who knows the
    // project id does not matter. A decline is expressed by never accepting,
    // so nothing is billed.
    //
    // The two verdicts read OPPOSITE senses — `decideLimit` reports `allowed`,
    // `decideReputation` reports `blocked` — so each is read on its own field
    // and never combined into one boolean.
    //
    // EACH FLAG IS SET INSIDE ITS OWN `try`, WHERE ITS OWN READ LANDS, AND
    // ACTED ON AFTER BOTH — so a throw in one read can never discard a decline
    // the other already earned. That is also why these reads stay sequential
    // here while TeXML batches the same three in a `Promise.all`: TeXML only
    // owes the caller words and sits on a carrier answer deadline, whereas
    // this is the layer that binds, and `Promise.all` rejects as a whole —
    // one slow `countCallerHistorySince` (two counts over 30 days, against the
    // cap's one same-day count) would fail the abuse cap open right here.
    //
    // TWO `try` BLOCKS, NOT ONE, AND THE SECOND ONE IS WHY. With both reads
    // sharing a single `try`, the protection ran ONE WAY only: the cap counts
    // are awaited first, so a throw in either of them aborted the block before
    // `countCallerHistorySince` was ever called and Guard 2 silently did not
    // run for that call. Fail-open, so the direction was safe — but it is the
    // inverse of what this comment advertises, it silently drops the guard
    // that matters MORE (a cap re-allows the same robot tomorrow; a reputation
    // block does not), and it hangs the more fragile read's fate on the less
    // fragile one. Split, neither read can take the other down in either
    // direction. Pinned from both sides: "caps exceeded AND the history read
    // throwing → still declined per-number" and "a cap read throwing must
    // still let Guard 2 block a repeat offender".
    let capsAllowed = true;
    let capsReason: "per-number" | "per-account" | undefined;
    try {
      const dayStart = utcDayStart(now);
      const forAccount = await countCallsSince(db, accountId, dayStart);
      const forNumber = callerNumber ? await countCallsByCallerSince(db, accountId, callerNumber, dayStart) : 0;
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        capsAllowed = false;
        capsReason = verdict.reason;
      }
    } catch (e) {
      log("call-limit counts failed — failing open", { callId, accountId, error: String(e) });
    }

    let blocked = false;
    let blockReason: "repeat-spam" | undefined;
    // A withheld caller id has no reputation to read: passing the null
    // through would score every anonymous caller on the account as one
    // number. `now` is the same instant `utcDayStart` above used, so the
    // window floor and the day floor come from one clock read.
    if (callerNumber) {
      try {
        const repCfg = readReputationConfig();
        const history = await countCallerHistorySince(
          db, accountId, callerNumber, windowStart(now, repCfg.windowDays),
        );
        const reputation = decideReputation(history, repCfg);
        if (reputation.blocked) {
          blocked = true;
          blockReason = reputation.reason;
        }
      } catch (e) {
        // Names the reputation read specifically: this is the only line an
        // operator gets when Guard 2 silently stops firing, and a shared
        // "call-limit" line would have pointed them at the wrong query
        // (TeXML's own line says "cap/reputation" because its three reads
        // genuinely do share one `Promise.all` and one catch).
        log("caller-reputation count failed — failing open", { callId, accountId, error: String(e) });
      }
    }
    // Reputation before the cap: a caller already known to be a robot should
    // not be described by the day's volume, and it is the more actionable of
    // the two log lines. Matches the TeXML route's own ordering, so the two
    // gates describe the same call the same way. The two orderings are pinned
    // by a case at each gate arranging a caller who is over the cap AND a
    // repeat offender; without one, the branches never contend and a swap is
    // invisible — a robot would hear "call back tomorrow", which invites it
    // back, and the one log line Guard 2 produces would name the wrong reason.
    //
    // RETURNING HERE, ABOVE `startCallRow` (step 10), IS LOAD-BEARING FOR
    // GUARD 2 — see `caller-reputation.ts`'s `windowStart` doc comment ("a
    // refused call writes no `calls` row at all"). A row written on a refusal
    // carries no outcome, `calls.outcome` defaults to `abandoned`, and
    // `countCallerHistorySince` counts anything that is not `spam` as
    // `otherCalls` — so the act of blocking a caller would clear their block
    // on the next call and Guard 2 would fire exactly once per number, in
    // silence. Anything that needs to surface a decline to an operator goes
    // through a log line, a metric or a new column, never through a `calls`
    // row. Pinned by the `startCallRow` assertions on both decline tests.
    if (blocked) {
      log("declined: blocked caller", { callId, accountId, reason: blockReason });
      return NextResponse.json({ ok: true, declined: blockReason });
    }
    if (!capsAllowed) {
      log("declined: call cap", { callId, accountId, reason: capsReason });
      return NextResponse.json({ ok: true, declined: capsReason });
    }

    // --- Step 9: account/branding context + the tenant's booking calendar -
    const accountRow = await loadAccountContext(db, accountId);
    const calendar = await getOrCreateCalendar(db, accountId, "voice", "ai");

    // --- Step 9b: where a caller who asks for a person can be sent --------
    // Resolved HERE, above the accept, because the accept body carries the
    // tool list and the handoff tool is only advertised when there is
    // somewhere to send them (`toolSchemas`' third argument).
    //
    // Its own try/catch, and it fails CLOSED rather than open: the two
    // fail-open branches in this route (the caps, `startCallRow`) both
    // protect the caller's ability to be ANSWERED. This one protects a
    // promise — "let me put you through" — and a promise made off a failed
    // read is a caller told they are being transferred and then hung up on.
    // The call itself still happens; only the transfer option is missing.
    //
    // Owned numbers come from `listPhoneNumbersForAccount` filtered here to
    // `testing`/`live`, NOT from `resolveSmsSender`: that helper returns no
    // list at all for an account holding only a `testing` number, which is
    // exactly the shape of an account still walking the setup wizard, and the
    // own-number loop guard would then silently not run for it.
    let handoffTarget: HandoffTarget = { available: false, reason: "not-configured" };
    try {
      const [transferPhone, ownedRows] = await Promise.all([
        getTransferPhone(db, accountId),
        listPhoneNumbersForAccount(db, accountId),
      ]);
      const owned = ownedRows
        .filter((n) => n.status === "testing" || n.status === "live")
        .map((n) => n.e164);
      handoffTarget = resolveHandoffTarget(transferPhone, owned);
    } catch (e) {
      log("handoff target lookup failed — this call answers without a transfer option",
        { callId, accountId, error: String(e) });
    }
    if (!handoffTarget.available) {
      log("no handoff target for this call", { callId, accountId, reason: handoffTarget.reason });
    }

    // --- Step 10: open the call row, fail-open (a DB blip must not lose
    // the call itself — finishCall tolerates a null callRowId). -----------
    //
    // The handoff token rides in on the SIP headers our own TeXML route
    // wrote (`X-BIS-Handoff`), raw — it is the credential the handoff route
    // authenticates with, so it is stored, never logged, and never coerced.
    // Absent on a call from a TeXML app that predates it: the column is then
    // left unset rather than written empty, so "no token" and "a token that
    // is the empty string" cannot be confused.
    const handoffToken = extractHandoffToken(event.data);
    let callRowId: string | null = null;
    try {
      const row = await startCallRow(db, accountId, {
        phoneNumberId: phoneRow.id, callerE164: callerNumber,
        ...(handoffToken ? { handoffToken } : {}),
      });
      callRowId = row.id;
    } catch (e) {
      log("startCallRow failed — proceeding without a row", { callId, accountId, error: String(e) });
    }

    // --- Step 11: accept the call -----------------------------------------
    // The branding is built HERE, above the prompt, rather than at step 12
    // with the two call-scoped contexts: the greeting a caller hears and the
    // business name the model answers as are customer-facing, so they come
    // from `brandDisplayName` — `accounts.name` is the agency's internal
    // label for the company ("Rio Roofing — trial") and Sofía was saying it
    // out loud on every call. Nothing between here and the accept can throw
    // on it (it is a field copy), so moving it up costs the accept nothing.
    const branding: Branding = {
      brandName: accountRow.brand_name, brandLogoPath: accountRow.brand_logo_path,
      brandColor: accountRow.brand_color, brandNeutral: accountRow.brand_neutral,
      brandCorners: accountRow.brand_corners, brandType: accountRow.brand_type,
      brandMode: accountRow.brand_mode, replyToEmail: accountRow.reply_to_email,
    };
    const businessName = brandDisplayName(branding);

    const greetingBase = profile.languages === "es" ? profile.greeting_es : profile.greeting_en;
    const greeting = greetingBase && greetingBase.trim()
      ? greetingBase
      : `Thanks for calling ${businessName}. How can I help you today?`;

    const promptInput: VoicePromptInput = {
      personaName: profile.persona_name, businessName, greeting,
      facts: profile.facts, services: profile.services, languages: profile.languages,
      bookingEnabled: profile.booking_enabled, timezone: accountRow.timezone,
      slotDurationMinutes: calendar.slot_duration_minutes, afterHours: profile.after_hours,
      callerNumber, meetingType: calendar.meeting_type,
      handoffAvailable: handoffTarget.available,
    };
    const sessionConfig = buildRealtimeSessionConfig(promptInput, now);

    // --- Step 12: build the call-scoped contexts BEFORE accepting --------
    // Deliberately built here, ahead of `acceptCall`, rather than after it
    // succeeds: once the call IS accepted, `after(...)` must be the very
    // next statement (see below) with zero statements in between that could
    // throw and leave a live, accepted call with nobody talking to it.
    // Building contexts first means the only thing left to do after a
    // successful accept is schedule the lifecycle. (`branding` itself is
    // built at step 11 above, because the prompt needs the resolved brand
    // name before the accept.)
    //
    // Cron-route precedent (`api/cron/reminders/route.ts`): this is a
    // webhook invocation, not a browser request forwarded through Vercel's
    // edge, so there is no forwarded-host chain to trust or distrust.
    // APP_ORIGIN wins when set (the custom domain); req.url's origin is only
    // the FALLBACK — and that fallback IS the deployment's own vercel.app
    // URL, the exact link/sender mismatch Gmail silently discarded mail over
    // (closed 2026-08-27; see origin.ts's doc comment).
    const origin = configuredOrigin() ?? new URL(req.url).origin;

    const toolCtx: ToolContext = {
      db, accountId, timezone: accountRow.timezone,
      calendar, profile, branding, fromEmail: accountRow.from_email ?? null,
      callerNumber, origin,
      callRowId, handoffTarget,
    };
    const finishCtx: FinishContext = {
      db, accountId, branding,
      notifyEmails: calendar.notify_emails, callerNumber, origin,
      profileLanguage: profile.languages, timezone: accountRow.timezone,
      // Read off the profile loaded at step 7, so the text-back decision is
      // pinned to the profile that answered THIS call rather than re-read
      // minutes later at hangup, when an operator may have toggled it.
      textbackEnabled: profile.textback_enabled, textbackBody: profile.textback_body,
    };

    // --- Step 13: accept the call, then IMMEDIATELY schedule the lifecycle
    try {
      await acceptCall(callId, apiKey, sessionConfig);
    } catch (e) {
      log("failed to accept call", { callId, error: String(e) });
      // Important #2: an unaccepted call was never actually answered — its
      // row (opened fail-open at step 10, before we knew accept would
      // succeed) must not litter the dashboard or count against the
      // tenant's daily caps. Its own try/catch: a cleanup failure logs and
      // never changes the 200 ack below — this webhook never surfaces a
      // stray 5xx (file header).
      if (callRowId) {
        try {
          await deleteCallRow(db, accountId, callRowId);
        } catch (cleanupErr) {
          log("accept-failure cleanup: deleteCallRow failed", { callId, callRowId, error: String(cleanupErr) });
        }
      }
      return NextResponse.json({ ok: true });
    }
    log("call accepted", { callId });
    after(() => runCallLifecycle({
      callId, apiKey, greeting, languages: profile.languages,
      callRowId, startedAt: now, toolCtx, finishCtx,
    }));

    return NextResponse.json({ ok: true });
  } catch (e) {
    log("unexpected failure handling incoming call", { error: String(e) });
    return NextResponse.json({ ok: true });
  }
}
