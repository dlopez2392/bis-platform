# Spam Screening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop paying for Realtime audio on calls where nobody ever speaks, and refuse a caller who has proven they are a robot before the SIP bridge is ever emitted.

**Architecture:** Two independent guards. Guard 1 is a silence timer in the Realtime lifecycle, armed beside the existing cost cap and cancelled the moment the caller makes a sound — it bounds a dead-air call at 30s instead of 240s. Guard 2 is a fourth verdict in the TeXML route's `classify()`, decided by a pure predicate that BOTH voice gates call, exactly as `callAnswerable` is shared today. Guard 1 is complete and shippable after Task 2; Guard 2 spans Tasks 3–6.

**Tech Stack:** Next.js App Router (route handlers, `runtime = "nodejs"`), TypeScript, Vitest, `ws` WebSocket, Supabase JS via `@bis/db`, Telnyx TeXML, OpenAI Realtime.

**Spec:** `docs/superpowers/specs/2026-09-15-spam-screening-design.md` — read it before Task 1. Every "why" below is justified there.

## Global Constraints

- **Branch `feat/spam-screening`, base `bda1b94`.** Never push to `main`; land through a PR. Both CI jobs (`verify`, `e2e`) must be green **on the PR's current head commit**, read from the check runs, before any merge.
- **No migration is required by any task in this plan.** `calls_caller_idx (account_id, caller_e164, started_at desc)` already exists (`0019_voice_core.sql:64`). If a task appears to need DDL, stop and escalate — do not write one.
- **Prove every test by mutating the code it guards and watching it fail BY NAME.** Never by reading the test. If a prescribed mutation stays green, investigate why before accepting it — this codebase has shipped eight tests that could not fail on their own claim. Record the observed failure message in the ledger.
- **Run the whole test file, never a `-t` filter.** A filter that matches nothing reports a green run with everything skipped. That has produced a false green in this repo before.
- **Three rules learned from Tasks 1 and 2's reviews, which found four more tests that could not fail. They bind every task below:**
  1. **Every test needs at least one mutation row that can fail it.** Task 2's mutation table had no row capable of failing one of its five tests; the implementer noticed and added the inverse mutation itself. A test with no row is a test nobody proved.
  2. **A negative fixture must be CLOSE BUT NOT A MEMBER.** For any predicate matching by prefix, set membership, or string equality, a totally-different value proves nothing. Task 1's tests could not distinguish `startsWith` from `includes` because neither negative fixture contained the substring at all, and could not distinguish `===` from a prefix match because no near-miss event name was tested.
  3. **Mutate the WIRING, not only the module.** Task 2's pure module was well tested while three of its call sites stayed green when broken — the env knob was never exercised, a whole argument was unpinned, and the spec's own backstop signal was never delivered through the wiring. Prove the call site, not just the callee.
  4. **An XOR assertion pins "not both and not neither" and nothing else.** Any case that must land on a *particular* side has to name that side. Task 5's mutual-exclusion block stayed green when its blocked verdict was turned into a bridge, because `refused !== bridged` is satisfied either way.
  5. **A constraint stated only in prose is a constraint nobody tests.** Two binding requirements — reputation deciding before the cap, and the env knobs actually reaching the gate — survived reversal and removal with the whole suite green, because no case arranged the conditions that put them in contention. If a task brief calls something binding, it owes that thing a mutation row.
- **Execute every mutation row before writing it into a brief.** Five prescribed rows in this plan could not fail: a falsy-coincidence (`Number(raw) || 3` matches `positiveInt` for `"0"`), a row whose target sat inside an outer fail-open catch, an XOR row, a row counting on an anonymous-caller test that does not exist, and a tenancy row no fixture could observe. A row that cannot fail is the same defect as a test that cannot fail, one level up.
- **A predicate fed from an external payload must not assume its input's type.** The Realtime socket's frames are untrusted; `handleMessage` wraps its JSON parse for exactly that reason. A throw inside the message path permanently rejects the serialization chain and silently drops the rest of the call.
- **Fail open, everywhere in this feature.** A database error in either guard must let the call through, matching `incoming/route.ts:44-49` ("losing a prospect costs more than paying for one extra robocall"). Guard 1 makes that decision cheaper, not obsolete. Do not "harden" the existing caps.
- **No new spoken copy.** A blocked caller hears the existing `COPY.refuse` sentence, which is already translated and already byte-pinned by `route.test.ts:120-125`. Only the server log line distinguishes the reason.
- **Env var defaults are starting values, not measured optima** — there is no real robocall corpus. Every knob follows the `positiveInt` house rule in `call-limits.ts:15-18`: junk, zero or negative falls back to the default, so a bad value can never disable a guard.
- **Do not touch the cost cap's goodbye instruction** (`incoming/route.ts:311-313`). Its open-ended wording is correct for a real conversation that runs long. Guard 1 gets its own constrained instruction; the two must not be "unified".

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/src/lib/voice/silence-guard.ts` | **Create.** Pure: how long to wait, what counts as caller audio, what the goodbye says. No socket, no timer. | 1 |
| `apps/web/src/lib/voice/silence-guard.test.ts` | **Create.** Unit tests for the above. | 1 |
| `apps/web/src/app/api/voice/incoming/route.ts` | **Modify.** Arm/cancel/clear the timer (Task 2); call the shared reputation predicate (Task 6). | 2, 6 |
| `apps/web/src/app/api/voice/incoming/lifecycle.test.ts` | **Modify.** Timer fires, timer cancels, outcome unchanged. | 2 |
| `apps/web/src/lib/voice/caller-reputation.ts` | **Create.** Pure: config read, window floor, the block decision. The ONE predicate both gates call. | 3 |
| `apps/web/src/lib/voice/caller-reputation.test.ts` | **Create.** Unit tests for the above. | 3 |
| `packages/db/src/voice.ts` | **Modify.** `countCallerHistorySince` — two counts, one call. | 4 |
| `packages/db/src/test/voice.test.ts` | **Modify.** Real-database tests for the new read. | 4 |
| `apps/web/src/app/api/voice/texml/route.ts` | **Modify.** Fourth `Routability` variant, branch above the bridge. | 5 |
| `apps/web/src/app/api/voice/texml/route.test.ts` | **Modify.** Block behaviour + the mutual-exclusion invariant. | 5 |
| `apps/web/src/app/api/voice/incoming/route.test.ts` | **Modify.** Webhook decline for a blocked caller. | 6 |
| `.env.example` | **Modify.** Document `PHONE_MAX_SILENT_SECONDS` (Task 1), `PHONE_SPAM_BLOCK_THRESHOLD` and `PHONE_SPAM_BLOCK_WINDOW_DAYS` (Task 3). | 1, 3 |

---

### Task 1: The silence guard's pure decisions

**Files:**
- Create: `apps/web/src/lib/voice/silence-guard.ts`
- Create: `apps/web/src/lib/voice/silence-guard.test.ts`
- Modify: `.env.example` (after line 81, below the `PHONE_MAX_CALL_SECONDS` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `readSilentSeconds(env?: NodeJS.ProcessEnv): number`; `isCallerAudioEvent(type: string | undefined): boolean`; `silenceGoodbye(languages: "en" | "es" | "both"): string`. Task 2 consumes all three.

Read `apps/web/src/lib/voice/call-limits.ts` first — this module is deliberately its twin in shape: pure, no database, no timers, so the route keeps the wiring and this keeps the decisions.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/voice/silence-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readSilentSeconds, isCallerAudioEvent, silenceGoodbye } from "./silence-guard";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("readSilentSeconds", () => {
  it("defaults to 30 with no configuration", () => {
    expect(readSilentSeconds(env({}))).toBe(30);
  });
  it("reads an override from env", () => {
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "45" }))).toBe(45);
  });
  it("ignores junk rather than disabling the guard", () => {
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "abc" }))).toBe(30);
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "-5" }))).toBe(30);
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "0" }))).toBe(30);
  });
  it("clamps to 5..120 — never long enough to be useless, never short enough to cut off a slow greeting", () => {
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "1" }))).toBe(5);
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "9999" }))).toBe(120);
  });
});

describe("isCallerAudioEvent", () => {
  it("accepts the whole input_audio_buffer namespace — the fast signal", () => {
    expect(isCallerAudioEvent("input_audio_buffer.speech_started")).toBe(true);
    expect(isCallerAudioEvent("input_audio_buffer.speech_stopped")).toBe(true);
    expect(isCallerAudioEvent("input_audio_buffer.committed")).toBe(true);
  });
  it("accepts the transcription completion — the signal classifyOutcome itself keys spam off", () => {
    expect(isCallerAudioEvent("conversation.item.input_audio_transcription.completed")).toBe(true);
  });
  it("rejects assistant and response events — Sofía talking is not the caller speaking", () => {
    expect(isCallerAudioEvent("response.output_audio_transcript.done")).toBe(false);
    expect(isCallerAudioEvent("response.created")).toBe(false);
    expect(isCallerAudioEvent("response.function_call_arguments.done")).toBe(false);
    expect(isCallerAudioEvent("session.updated")).toBe(false);
  });
  it("rejects a missing or empty type without throwing", () => {
    expect(isCallerAudioEvent(undefined)).toBe(false);
    expect(isCallerAudioEvent("")).toBe(false);
  });
  it("does not accept a merely similar prefix", () => {
    expect(isCallerAudioEvent("input_audio_buffer_cleared")).toBe(false);
    expect(isCallerAudioEvent("output_audio_buffer.started")).toBe(false);
  });
});

describe("silenceGoodbye", () => {
  it("is the CONSTRAINED form, not the cap's open-ended wrap-up", () => {
    // The distinction is the whole reason the 247s call produced a fabricated
    // record: asking a model to "wrap up" a conversation that never happened
    // is asking it to invent one. See the spec's "The call this feature is
    // built from".
    expect(silenceGoodbye("en")).toContain("exactly");
    expect(silenceGoodbye("en")).not.toContain("wrap up");
  });
  it("speaks Spanish for an es-only profile, English otherwise — mirroring the greeting's own rule", () => {
    expect(silenceGoodbye("es")).toContain("No puedo escuchar");
    expect(silenceGoodbye("en")).toContain("can't hear");
    // `both` takes English, exactly as the greeting does at
    // incoming/route.ts:507 (`languages === "es" ? greeting_es : greeting_en`).
    expect(silenceGoodbye("both")).toBe(silenceGoodbye("en"));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd apps/web && npx vitest run src/lib/voice/silence-guard.test.ts
```

Expected: FAIL — `Failed to resolve import "./silence-guard"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/voice/silence-guard.ts`:

```ts
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
 * mistyped env var must never silently remove a cost control. The upper
 * clamp is 120s, comfortably under `PHONE_MAX_CALL_SECONDS`' 240 default, so
 * this guard always fires first on a silent call; the lower clamp is 5s so
 * it can never fire before a slow greeting has even played.
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
 */
export function isCallerAudioEvent(type: string | undefined): boolean {
  if (!type) return false;
  if (type.startsWith("input_audio_buffer.")) return true;
  return type === "conversation.item.input_audio_transcription.completed";
}

/**
 * The line a silent caller hears before the hangup.
 *
 * MUST stay the CONSTRAINED form ("Say exactly...") the greeting uses at
 * `incoming/route.ts:239-241`. It must NEVER be merged with the cost cap's
 * open-ended "Politely wrap up and say a brief goodbye to the caller — we're
 * out of time" (`incoming/route.ts:311-313`).
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
 * `incoming/route.ts:507` rather than inventing a second language policy.
 */
export function silenceGoodbye(languages: "en" | "es" | "both"): string {
  const line = languages === "es"
    ? "Lo siento, no puedo escuchar nada. Por favor llame de nuevo si necesita ayuda. Adiós."
    : "Sorry, I can't hear anything. Please call back if you need us. Goodbye.";
  return `Say exactly this and nothing else: "${line}"`;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd apps/web && npx vitest run src/lib/voice/silence-guard.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the tests by mutation**

Run each mutation, confirm the named test fails, then **restore the file**:

| Mutation in `silence-guard.ts` | Test that must fail |
|---|---|
| Change `DEFAULT_SILENT_SECONDS` to `60` | `defaults to 30 with no configuration` |
| Delete the `Math.min(Math.max(...))` clamp, return `Math.floor(n)` | `clamps to 5..120 ...` |
| Change `if (!Number.isFinite(n) \|\| n <= 0)` to `if (!Number.isFinite(n))` | `ignores junk rather than disabling the guard` |
| Change `startsWith("input_audio_buffer.")` to `startsWith("input_audio_buffer")` | `does not accept a merely similar prefix` |
| Make `isCallerAudioEvent` return `true` for `response.` types too | `rejects assistant and response events ...` |
| Replace `silenceGoodbye`'s body with the cap's `"Politely wrap up..."` string | `is the CONSTRAINED form, not the cap's open-ended wrap-up` |

Record the exact failure message for the last one in the ledger — it is the guard against the refactor this feature most fears.

- [ ] **Step 6: Document the env var**

In `.env.example`, immediately after the `PHONE_MAX_CALL_SECONDS=` line (currently line 80) and before the `PHONE_CONNECT_TIMEOUT_MS` comment block, insert:

```
# How long a call may produce NO caller audio at all before it is ended,
# seconds. Clamped to 5-120. The cost guardrail above bounds a call that is
# going somewhere; this one bounds a call that is not — a robot that connects
# and says nothing billed the full PHONE_MAX_CALL_SECONDS before this
# existed. Cancelled by the first sound the caller makes, so it never affects
# a real customer. Default: 30.
PHONE_MAX_SILENT_SECONDS=
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/voice/silence-guard.ts apps/web/src/lib/voice/silence-guard.test.ts .env.example
git commit -m "feat(voice): pure decisions for the silent-call cutoff"
```

---

### Task 2: Arm the silence cutoff in the Realtime lifecycle

**Files:**
- Modify: `apps/web/src/app/api/voice/incoming/route.ts` (`LifecycleArgs` at `:124-132`; `runCallLifecycle` timer declarations at `:146-150`; `finish()` teardown at `:168-171`; `ws.on("open")` after the `capTimer` block ending `:321`; `handleMessage` at `:367-383`; the `runCallLifecycle` call site inside step 13, near `:576`)
- Modify: `apps/web/src/app/api/voice/incoming/lifecycle.test.ts`

**Interfaces:**
- Consumes: `readSilentSeconds`, `isCallerAudioEvent`, `silenceGoodbye` from Task 1.
- Produces: nothing new for later tasks. **Guard 1 is complete and independently shippable at the end of this task.**

Read `apps/web/src/app/api/voice/incoming/route.ts:144-330` in full before editing. The timer you are adding is a deliberate copy of `capTimer`'s shape, including its `closeTimer` follow-up — reuse that pattern rather than inventing a second way to end a call.

- [ ] **Step 1: Write the failing tests**

Open `apps/web/src/app/api/voice/incoming/lifecycle.test.ts` and read how the existing suite drives a fake socket and advances fake timers. Add a new `describe` block matching that file's established harness (use its existing socket double and `vi.useFakeTimers()` setup rather than a new one):

```ts
describe("silence cutoff (Guard 1)", () => {
  it("a call where nobody ever speaks is ended at PHONE_MAX_SILENT_SECONDS, not the cost cap", async () => {
    // Drive the lifecycle, open the socket, advance 30s WITHOUT delivering any
    // caller-audio event, and assert the goodbye went out and the socket closed.
    // The cap is 240s; if this call survives to 240 the guard did nothing.
    // Assert on the instruction actually sent:
    expect(sent).toContainEqual(expect.objectContaining({
      type: "response.create",
      response: expect.objectContaining({
        instructions: expect.stringContaining("Say exactly this and nothing else"),
      }),
    }));
    expect(socket.close).toHaveBeenCalled();
  });

  it("one sound from the caller cancels the cutoff — the call survives past the window", async () => {
    // Deliver { type: "input_audio_buffer.speech_started" } at 5s, then advance
    // well past 30s. No goodbye, no close. THIS is the test that protects real
    // customers, and it must fail if the cancel is removed.
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("Sofía's own audio does NOT cancel the cutoff", async () => {
    // Deliver { type: "response.output_audio_transcript.done", transcript: "..." }
    // — the greeting. Advance past 30s. The call is still cut.
    // This is the 247-second call's exact shape: assistant turns only.
    expect(socket.close).toHaveBeenCalled();
  });

  it("a cut call still records as spam — Guard 1 changes the BILL, not the record", async () => {
    // Nobody speaks; advance past the window; let the close settle.
    // `finishCall` is MOCKED in this file, so the real classifyOutcome never
    // runs here and this test cannot observe the outcome label at all —
    // asserting "spam" against a mock would assert nothing. What it CAN prove
    // is the state handed over: no caller transcript event, which is exactly
    // the condition classifyOutcome reads to return "spam" (call-state.ts:62).
    // The label itself is already covered by call-state.test.ts; this pins
    // that Guard 1 does not disturb the input that produces it.
    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const [stateArg] = finishCallMock.mock.calls[0];
    expect(stateArg.transcript.some((t: { role: string }) => t.role === "caller")).toBe(false);
    expect(stateArg.bookings).toEqual([]);
    expect(stateArg.leads).toEqual([]);
    expect(stateArg.messages).toEqual([]);
  });

  it("the cost cap keeps its own open-ended wrap-up instruction", async () => {
    // A call WITH caller speech that runs to 240s still sends
    // "Politely wrap up". The obvious refactor is to share one goodbye string
    // between the two timers; this test is what stops it.
    expect(sent).toContainEqual(expect.objectContaining({
      response: expect.objectContaining({
        instructions: expect.stringContaining("Politely wrap up"),
      }),
    }));
  });
});
```

Fill each body using the harness already present in the file. Do not introduce a second mocking style.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd apps/web && npx vitest run src/app/api/voice/incoming/lifecycle.test.ts -t "silence cutoff"
```

Expected: FAIL — the call survives the window, no goodbye is sent, `close` is not called.

**If any of these five passes before the implementation exists, stop and find out why.** A vacuously-green test here is exactly the class this repo keeps shipping.

- [ ] **Step 3: Write the implementation**

**3a.** Add the import at the top of `route.ts`, beside the other `@/lib/voice/*` imports:

```ts
import { readSilentSeconds, isCallerAudioEvent, silenceGoodbye } from "@/lib/voice/silence-guard";
```

**3b.** Add `languages` to `LifecycleArgs` (`:124-132`):

```ts
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
```

**3c.** Destructure it and declare the timer in `runCallLifecycle` (`:144-151`):

```ts
function runCallLifecycle(args: LifecycleArgs): Promise<void> {
  const { callId, apiKey, greeting, languages, callRowId, startedAt, toolCtx, finishCtx } = args;
  let state = emptyCallState();
  let capTimer: NodeJS.Timeout | undefined;
  let closeTimer: NodeJS.Timeout | undefined;
  let greetTimer: NodeJS.Timeout | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  let silenceTimer: NodeJS.Timeout | undefined;
  let settled = false;
```

**3d.** Clear it in `finish()`, beside its siblings (`:168-171`):

```ts
      clearTimeout(capTimer);
      clearTimeout(closeTimer);
      clearTimeout(greetTimer);
      clearTimeout(connectTimer);
      clearTimeout(silenceTimer);
```

**3e.** Arm it in `ws.on("open")`, immediately AFTER the `capTimer = setTimeout(...)` block that ends at `:321`:

```ts
      // Cost guardrail #2: the cap above bounds a call that is going
      // somewhere. This one bounds a call that is not. A robot that connects
      // and says nothing used to bill the full `maxSeconds` — see the
      // 247-second call in the spec, whose only two transcript events were
      // four minutes apart and both Sofía's.
      //
      // Armed here rather than after the greeting for the same reason
      // `capTimer` is: one timer, one origin, no second lifecycle concept to
      // keep in sync. The 5s floor in `readSilentSeconds` is what keeps a
      // slow greeting safe.
      const silentSeconds = readSilentSeconds();
      silenceTimer = setTimeout(() => {
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
        }, 5000);
      }, silentSeconds * 1000);
```

**3f.** Cancel it in `handleMessage`, immediately after the JSON parse and before `processCallEvent` (`:367-383`):

```ts
    async function handleMessage(raw: WebSocket.RawData): Promise<void> {
      let event: RealtimeCallEvent;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        log("failed to parse call event", { callId });
        return;
      }
      // Cancelled here — BEFORE `processCallEvent`, so a throw inside tool
      // handling can never leave the guard armed on a call where the caller
      // is plainly talking. One sound is enough and it is permanent: this
      // guard asks "did anyone ever speak", which is exactly the question
      // `classifyOutcome` asks to decide `spam`, so it is never re-armed.
      if (silenceTimer && isCallerAudioEvent(event?.type)) {
        clearTimeout(silenceTimer);
        silenceTimer = undefined;
        log("caller audio detected, silence guard cleared", { callId, type: event?.type });
      }
      try {
        const result = await processCallEvent(state, toolCtx, event);
```

**3g.** Pass `languages` at the `runCallLifecycle` call site in step 13 (near `:576`). The value is already in scope as `profile.languages` — the same field step 11 reads at `:507`:

```ts
    after(() => runCallLifecycle({
      callId, apiKey, greeting, languages: profile.languages,
      callRowId, startedAt, toolCtx, finishCtx,
    }));
```

Match the existing call's argument formatting; add only the `languages` property.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd apps/web && npx vitest run src/app/api/voice/incoming/lifecycle.test.ts
```

Expected: PASS — the whole file, not just the new block. The existing lifecycle tests must be untouched.

- [ ] **Step 5: Prove the tests by mutation**

| Mutation in `route.ts` | Test that must fail |
|---|---|
| Delete the `clearTimeout(silenceTimer)` cancel in `handleMessage` (3f) | `one sound from the caller cancels the cutoff ...` |
| Delete the whole `silenceTimer = setTimeout(...)` block (3e) | `a call where nobody ever speaks is ended ...` |
| Change the cancel condition to `event?.type !== undefined` (cancel on anything) | `Sofía's own audio does NOT cancel the cutoff` |
| Change `silenceGoodbye(languages)` to the cap's `"Politely wrap up..."` string | `a call where nobody ever speaks ...` (the `Say exactly` assertion) |
| Remove `clearTimeout(silenceTimer)` from `finish()` (3d) | Expect a leaked-timer/open-handle complaint from vitest; if nothing fails, say so plainly in the ledger rather than claiming it is covered |

- [ ] **Step 6: Run the web test suite**

```bash
cd apps/web && npx vitest run
```

Expected: exit 0. Report the file/test totals.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/voice/incoming/route.ts apps/web/src/app/api/voice/incoming/lifecycle.test.ts
git commit -m "feat(voice): end a call nobody is speaking on, 30s instead of 240s"
```

---

### Task 3: The caller-reputation predicate

**Files:**
- Create: `apps/web/src/lib/voice/caller-reputation.ts`
- Create: `apps/web/src/lib/voice/caller-reputation.test.ts`
- Modify: `.env.example` (after the `PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY=` line, currently line 106)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ReputationConfig = { threshold: number; windowDays: number }`
  - `type ReputationVerdict = { blocked: false } | { blocked: true; reason: "repeat-spam" }`
  - `type CallerHistory = { spamCalls: number; otherCalls: number }`
  - `readReputationConfig(env?: NodeJS.ProcessEnv): ReputationConfig`
  - `windowStart(now: Date, windowDays: number): string` (ISO)
  - `decideReputation(history: CallerHistory, cfg: ReputationConfig): ReputationVerdict`

  Tasks 4, 5 and 6 all consume these exact names. `CallerHistory`'s field names must match the object Task 4's database read returns.

Read `apps/web/src/lib/voice/call-limits.ts` and `apps/web/src/lib/voice/accept-gate.ts` first. This module is `call-limits.ts`'s shape (pure config + verdict) serving `accept-gate.ts`'s purpose (ONE predicate, two gates, so they cannot drift).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/voice/caller-reputation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  readReputationConfig, decideReputation, windowStart, type ReputationConfig,
} from "./caller-reputation";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const cfg: ReputationConfig = { threshold: 3, windowDays: 30 };

describe("readReputationConfig", () => {
  it("defaults to 3 calls over 30 days", () => {
    expect(readReputationConfig(env({}))).toEqual({ threshold: 3, windowDays: 30 });
  });
  it("reads overrides from env", () => {
    expect(readReputationConfig(env({
      PHONE_SPAM_BLOCK_THRESHOLD: "5", PHONE_SPAM_BLOCK_WINDOW_DAYS: "7",
    }))).toEqual({ threshold: 5, windowDays: 7 });
  });
  it("ignores junk rather than blocking on the first silent call", () => {
    expect(readReputationConfig(env({
      PHONE_SPAM_BLOCK_THRESHOLD: "0", PHONE_SPAM_BLOCK_WINDOW_DAYS: "-1",
    }))).toEqual(readReputationConfig(env({})));
    expect(readReputationConfig(env({ PHONE_SPAM_BLOCK_THRESHOLD: "abc" })).threshold).toBe(3);
  });
});

describe("decideReputation", () => {
  it("blocks a caller at the threshold with nothing but spam", () => {
    expect(decideReputation({ spamCalls: 3, otherCalls: 0 }, cfg))
      .toEqual({ blocked: true, reason: "repeat-spam" });
    expect(decideReputation({ spamCalls: 9, otherCalls: 0 }, cfg))
      .toEqual({ blocked: true, reason: "repeat-spam" });
  });

  it("allows a caller below the threshold", () => {
    expect(decideReputation({ spamCalls: 2, otherCalls: 0 }, cfg)).toEqual({ blocked: false });
  });

  it("ALLOWS the shape that actually exists in the database: 4 spam AND 13 good", () => {
    // This is not a hypothetical. +19562921696 is simultaneously the top spam
    // caller and the top booker in the live `calls` table. A rule that counted
    // spam without also requiring zero good outcomes would have blocked the
    // best customer on file. This test is that clause's reason for existing.
    expect(decideReputation({ spamCalls: 4, otherCalls: 13 }, cfg)).toEqual({ blocked: false });
  });

  it("a single good outcome of any kind clears the caller completely", () => {
    expect(decideReputation({ spamCalls: 50, otherCalls: 1 }, cfg)).toEqual({ blocked: false });
  });

  it("allows a caller with no history at all — a first-time caller is never a robot", () => {
    expect(decideReputation({ spamCalls: 0, otherCalls: 0 }, cfg)).toEqual({ blocked: false });
  });
});

describe("windowStart", () => {
  it("is windowDays before now, as an ISO instant", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(windowStart(now, 30)).toBe("2026-08-16T12:00:00.000Z");
  });
  it("a shorter window moves the floor forward", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(windowStart(now, 7)).toBe("2026-09-08T12:00:00.000Z");
  });
  it("is a rolling instant, not a calendar boundary — a block must expire on its own", () => {
    // Load-bearing: a refused call writes NO `calls` row (startCallRow is
    // step 10, after every gate), so a blocked caller can never produce the
    // good outcome that would clear them. Without the window sliding, the
    // block is permanent and unappealable.
    const a = windowStart(new Date("2026-09-15T12:00:00.000Z"), 30);
    const b = windowStart(new Date("2026-09-16T12:00:00.000Z"), 30);
    expect(b > a).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd apps/web && npx vitest run src/lib/voice/caller-reputation.test.ts
```

Expected: FAIL — `Failed to resolve import "./caller-reputation"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/voice/caller-reputation.ts`:

```ts
// Pure decision logic for refusing a caller who has proven they are a robot
// (spam-screening spec, Guard 2). Shaped like `call-limits.ts` — no database,
// so the decision is trivially unit-testable — and serving the purpose
// `accept-gate.ts` states: ONE predicate that BOTH voice gates call, so the
// TeXML route's spoken refusal and the webhook's silent decline can never
// drift out of agreement.
//
// The try/catch and fail-open wrapping live in the routes, not here.

export type ReputationConfig = { threshold: number; windowDays: number };
export type ReputationVerdict = { blocked: false } | { blocked: true; reason: "repeat-spam" };

/** Counts over the window, from `countCallerHistorySince`. `spamCalls`
 *  counts ONLY rows with at least one turn — see the exclusion note there. */
export type CallerHistory = { spamCalls: number; otherCalls: number };

const DEFAULTS: ReputationConfig = { threshold: 3, windowDays: 30 };

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Both knobs are starting values, not measured optima: there is not a single
 * real robocall in this product's database, so there is nothing to tune
 * against yet. Junk falls back rather than taking effect — a `threshold` of 0
 * would block every caller on their first silent call, which is the worst
 * failure this feature could have.
 *
 * Against the existing per-caller cap of 5 calls/day, a threshold of 3 means a
 * robot is refused partway through its first day and costs nothing after that.
 */
export function readReputationConfig(env: NodeJS.ProcessEnv = process.env): ReputationConfig {
  return {
    threshold: positiveInt(env.PHONE_SPAM_BLOCK_THRESHOLD, DEFAULTS.threshold),
    windowDays: positiveInt(env.PHONE_SPAM_BLOCK_WINDOW_DAYS, DEFAULTS.windowDays),
  };
}

/**
 * The floor of the rolling window, as an ISO instant.
 *
 * Rolling, NOT a calendar boundary, and this is load-bearing rather than
 * cosmetic: a refused call writes no `calls` row at all (`startCallRow` is
 * step 10, after every gate), so a blocked caller can never generate the good
 * outcome that would clear them. If the window did not slide, the first block
 * would be permanent and unappealable. Because it slides, a caller who stops
 * calling ages out of their own block.
 */
export function windowStart(now: Date, windowDays: number): string {
  return new Date(now.getTime() - windowDays * 86_400_000).toISOString();
}

/**
 * Refuse only a caller whose ENTIRE history in the window is spam.
 *
 * `otherCalls === 0` is mandatory, not a refinement. In the live `calls`
 * table one number is simultaneously the top spam caller (4) and the top
 * booker (13): a rule that counted spam alone would have refused the best
 * customer in the database. One booking, lead, message — or even one
 * `abandoned`, which means a human spoke — clears the caller completely.
 *
 * Non-strict `>=`, matching `decideLimit`: `threshold: 3` means three silent
 * calls are enough.
 */
export function decideReputation(
  history: CallerHistory, cfg: ReputationConfig,
): ReputationVerdict {
  if (history.otherCalls > 0) return { blocked: false };
  if (history.spamCalls >= cfg.threshold) return { blocked: true, reason: "repeat-spam" };
  return { blocked: false };
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd apps/web && npx vitest run src/lib/voice/caller-reputation.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the tests by mutation**

| Mutation in `caller-reputation.ts` | Test that must fail |
|---|---|
| Delete `if (history.otherCalls > 0) return { blocked: false };` | `ALLOWS the shape that actually exists in the database: 4 spam AND 13 good` |
| Change `>=` to `>` in the threshold comparison | `blocks a caller at the threshold with nothing but spam` |
| Change `positiveInt(..., DEFAULTS.threshold)` to `Number(raw) \|\| 3` | `ignores junk rather than blocking on the first silent call` (the `"0"` case) |
| Make `windowStart` return a fixed epoch string | `is a rolling instant, not a calendar boundary ...` |

- [ ] **Step 6: Document the env vars**

In `.env.example`, immediately after the `PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY=` line (currently line 106), insert:

```
# Refuse a caller whose whole recent history on this account is silent calls,
# before the call is ever bridged to the model. Blocks only when EVERY call in
# the window classified spam AND at least this many did — one booking, lead,
# message or even one call where a human spoke clears the caller completely.
# Default: 3.
PHONE_SPAM_BLOCK_THRESHOLD=
# How far back that history is read, days. Rolling, so a block expires on its
# own: a refused call writes no row, so a blocked caller could otherwise never
# earn their way back. Default: 30.
PHONE_SPAM_BLOCK_WINDOW_DAYS=
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/voice/caller-reputation.ts apps/web/src/lib/voice/caller-reputation.test.ts .env.example
git commit -m "feat(voice): the shared predicate for refusing a repeat silent caller"
```

---

### Task 4: The caller-history database read

**Files:**
- Modify: `packages/db/src/voice.ts` (add after `countCallsByCallerSince`, which ends at `:189`)
- Modify: `packages/db/src/test/voice.test.ts` (add to the existing suite; import the new function in the `@bis/db` import block at `:10`)

**Interfaces:**
- Consumes: nothing. (The return shape must match Task 3's `CallerHistory`, but this module does not import from `apps/web`.)
- Produces: `countCallerHistorySince(db: SupabaseClient, accountId: string, callerE164: string, sinceIso: string): Promise<{ spamCalls: number; otherCalls: number }>`. Tasks 5 and 6 consume it via the `@bis/db` barrel.

Read `countCallsByCallerSince` (`:181-189`) first — this is its sibling and must match its style, its error-message convention, and its `.eq("account_id", ...)` tenancy guard.

**Why two counts and not a list of rows:** the decision needs only "are there any non-spam calls" and "how many spam calls", and `count: "exact", head: true` transfers no rows at all. Listing rows would need a `.limit()`, and a truncated list could hide an older good outcome and produce a false block — the one failure this feature must not have.

- [ ] **Step 1: Write the failing test**

Add `countCallerHistorySince` to the `@bis/db` import at the top of `packages/db/src/test/voice.test.ts`, then add:

```ts
  it("countCallerHistorySince: splits one caller's window into spam and everything else", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const robot = "+19565550301";
      const human = "+19565550302";

      const finish = async (id: string, outcome: CallOutcome, turnCount: number) =>
        finishCallRow(db, accountId, id, {
          outcome, endedAt: new Date(), durationSecs: 20, turnCount,
          transcript: [], summary: "", language: "en",
        });

      const a = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: robot });
      const b = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: robot });
      const c = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: human });
      await finish(a.id, "spam", 1);
      await finish(b.id, "spam", 1);
      await finish(c.id, "booked", 12);

      expect(await countCallerHistorySince(db, accountId, robot, since))
        .toEqual({ spamCalls: 2, otherCalls: 0 });
      // Scoped to ONE caller: the human's booking must not appear in the
      // robot's history, or the block would never fire.
      expect(await countCallerHistorySince(db, accountId, human, since))
        .toEqual({ spamCalls: 0, otherCalls: 1 });
    });
  });

  it("countCallerHistorySince: a zero-turn spam row is EXCLUDED — that is our connect timeout, not a robot", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const caller = "+19565550303";

      // `incoming/route.ts:185-193`: a connect-timeout records outcome "spam"
      // with turn_count 0, because the socket never opened and nothing was
      // ever mirrored into the state. That is OUR infrastructure failing.
      // Counting it toward a block would refuse an innocent caller for our
      // own outage — the worst false positive this feature can produce.
      const t = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, t.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 0, turnCount: 0,
        transcript: [], summary: "", language: "en",
      });
      // A genuine silent call still carries the greeting, so it has >= 1 turn.
      const g = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, g.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 30, turnCount: 1,
        transcript: [], summary: "", language: "en",
      });

      expect(await countCallerHistorySince(db, accountId, caller, since))
        .toEqual({ spamCalls: 1, otherCalls: 0 });
    });
  });

  it("countCallerHistorySince: honours the window floor and the account boundary", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const caller = "+19565550304";
      const r = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      await finishCallRow(db, accountId, r.id, {
        outcome: "spam", endedAt: new Date(), durationSecs: 30, turnCount: 1,
        transcript: [], summary: "", language: "en",
      });

      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(await countCallerHistorySince(db, accountId, caller, future))
        .toEqual({ spamCalls: 0, otherCalls: 0 });

      // A fabricated other account must see nothing — the tenancy guard is a
      // security property, not an optimisation.
      expect(await countCallerHistorySince(
        db, "00000000-0000-0000-0000-000000000099", caller,
        new Date(Date.now() - 86_400_000).toISOString(),
      )).toEqual({ spamCalls: 0, otherCalls: 0 });
    });
  });

  it("countCallerHistorySince: an UNFINISHED row counts as other, never as spam", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const caller = "+19565550305";
      // startCallRow leaves outcome at its column default, 'abandoned'. A call
      // still in flight, or one whose process died before finishCallRow, reads
      // as "other" and therefore CLEARS the caller. That is the safe direction
      // — toward letting a call through — and it is intended, not incidental.
      await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: caller });
      expect(await countCallerHistorySince(db, accountId, caller, since))
        .toEqual({ spamCalls: 0, otherCalls: 1 });
    });
  });
```

`CallOutcome` is already exported from `@bis/db` (`voice.ts:18`); add it to the test file's type import if it is not already there.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd packages/db && npx vitest run src/test/voice.test.ts -t "countCallerHistorySince"
```

Expected: FAIL — `countCallerHistorySince is not a function`.

**Verify the filter actually matched tests.** If the run reports 0 failures with everything skipped, the `-t` pattern matched nothing — that silent-skip trap has cost this repo a false green before. Confirm the run says 4 tests.

- [ ] **Step 3: Write the implementation**

Add to `packages/db/src/voice.ts`, immediately after `countCallsByCallerSince` (`:189`):

```ts
/**
 * One caller's history on one account since `sinceIso`, split two ways: how
 * many calls classified `spam`, and how many classified anything else.
 *
 * Feeds the voice gates' repeat-offender refusal (`decideReputation` in
 * `apps/web/src/lib/voice/caller-reputation.ts`), which blocks only when
 * `otherCalls` is zero — so the split, not the total, is the whole point.
 *
 * TWO COUNTS RATHER THAN A LIST OF ROWS, deliberately. `count: "exact", head:
 * true` transfers no rows, so neither query needs a `.limit()`; a limited list
 * could truncate away an older good outcome and produce a false block, which
 * is the one failure mode this guard must not have. Both queries ride
 * `calls_caller_idx (account_id, caller_e164, started_at desc)`, already
 * present since 0019 — no new index is needed.
 *
 * `turn_count >= 1` on the spam side is an EXCLUSION, not a filter for
 * tidiness: a connect-timeout also records `spam`, with `turn_count` 0,
 * because the socket never opened and nothing was mirrored into the call
 * state (see the honesty note in `api/voice/incoming/route.ts`). That is our
 * infrastructure failing, not a robot calling, and refusing a caller because
 * of our own outage is the worst false positive available here. A genuine
 * silent call still carries the greeting, so it always has at least one turn.
 *
 * An UNFINISHED row (still in flight, or one whose process died before
 * `finishCallRow`) carries the column default `abandoned` and so counts as
 * `otherCalls`. That errs toward letting the caller through, which is the
 * direction every gate in this path errs.
 */
export async function countCallerHistorySince(
  db: SupabaseClient, accountId: string, callerE164: string, sinceIso: string,
): Promise<{ spamCalls: number; otherCalls: number }> {
  const [spam, other] = await Promise.all([
    db.from("calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("caller_e164", callerE164)
      .gte("started_at", sinceIso).eq("outcome", "spam").gte("turn_count", 1),
    db.from("calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("caller_e164", callerE164)
      .gte("started_at", sinceIso).neq("outcome", "spam"),
  ]);
  if (spam.error) throw new Error(`countCallerHistorySince failed: ${spam.error.message}`);
  if (other.error) throw new Error(`countCallerHistorySince failed: ${other.error.message}`);
  return { spamCalls: spam.count ?? 0, otherCalls: other.count ?? 0 };
}
```

Confirm it is exported from the `@bis/db` barrel — check `packages/db/src/index.ts` for how `countCallsByCallerSince` is re-exported and match it exactly.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd packages/db && npx vitest run src/test/voice.test.ts
```

Expected: PASS — the whole file.

- [ ] **Step 5: Prove the tests by mutation**

| Mutation in `voice.ts` | Test that must fail |
|---|---|
| Delete `.gte("turn_count", 1)` from the spam query | `a zero-turn spam row is EXCLUDED ...` |
| Delete `.eq("account_id", accountId)` from either query | `honours the window floor and the account boundary` |
| Delete `.eq("caller_e164", callerE164)` from either query | `splits one caller's window into spam and everything else` |
| Change `.neq("outcome", "spam")` to `.eq("outcome", "booked")` | `an UNFINISHED row counts as other, never as spam` |
| Swap the returned `spamCalls`/`otherCalls` fields | `splits one caller's window ...` |

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/voice.ts packages/db/src/index.ts packages/db/src/test/voice.test.ts
git commit -m "feat(db): split a caller's recent history into spam and everything else"
```

---

### Task 5: Refuse a repeat offender in the TeXML route

**Files:**
- Modify: `apps/web/src/app/api/voice/texml/route.ts` (`Routability` at `:24-27`; `classify()`'s cap block at `:88-103`; `respond()` at `:170-175`)
- Modify: `apps/web/src/app/api/voice/texml/route.test.ts`

**Interfaces:**
- Consumes: `readReputationConfig`, `decideReputation`, `windowStart` (Task 3); `countCallerHistorySince` (Task 4).
- Produces: nothing for later tasks. Task 6 wires the same predicate into the webhook independently.

Read all of `apps/web/src/app/api/voice/texml/route.ts` first, and its file header at `:1-15` — it states the architecture you are extending: this route exists to give the caller WORDS, and the webhook stays authoritative.

**This is the task the spec's testing rule is written for.** A refusal must happen before the SIP bridge, and a test must fail if that ordering is ever reversed.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/app/api/voice/texml/route.test.ts`. The file already mocks `@bis/db` wholesale at `:10-16` — add `countCallerHistorySince` to that mock and default it to `{ spamCalls: 0, otherCalls: 0 }` in the `beforeEach` fixture at `:30-36`, so every existing test keeps passing unchanged.

```ts
describe("texml route — repeat-offender refusal (Guard 2)", () => {
  it("a caller with nothing but silent calls is refused, and never gets a Dial", async () => {
    historyMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const xml = await get({ To: "+19565061545", From: "+19565550301" });
    expect(xml).toContain("Sorry, this number can't take your call right now.");
    expect(xml).not.toContain("<Dial");
  });

  it("a caller with ANY good outcome is dialled, however much spam they also have", async () => {
    // The live-data shape: the top spam caller is also the top booker.
    historyMock.mockResolvedValue({ spamCalls: 4, otherCalls: 13 });
    const xml = await get({ To: "+19565061545", From: "+19562921696" });
    expect(xml).toContain("<Dial");
  });

  it("uses the EXISTING refusal copy — no new sentence is introduced", async () => {
    historyMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const xml = await get({ To: "+19565061545", From: "+19565550301" });
    // Byte-identical to the sentence route.test.ts:120-125 already pins.
    expect(xml).toContain("Sorry, this number can't take your call right now. Please try again later.");
  });

  it("the history read failing fails OPEN — a database blip dials, never refuses", async () => {
    historyMock.mockRejectedValue(new Error("boom"));
    const xml = await get({ To: "+19565061545", From: "+19565550301" });
    expect(xml).toContain("<Dial");
  });

  it("is read over the configured rolling window, from the caller and account in hand", async () => {
    historyMock.mockResolvedValue({ spamCalls: 0, otherCalls: 0 });
    await get({ To: "+19565061545", From: "+19565550301" });
    expect(historyMock).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "+19565550301", expect.any(String),
    );
    const since = new Date(historyMock.mock.calls[0][3]);
    const days = (Date.now() - since.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("a caller with no number at all is not blocked — there is no history to read", async () => {
    const xml = await get({ To: "+19565061545" });
    expect(xml).toContain("<Dial");
    expect(historyMock).not.toHaveBeenCalled();
  });
});

describe("texml route — a refusal and the bridge are mutually exclusive", () => {
  // The ordering guarantee this architecture admits. Every verdict produces
  // EITHER spoken refusal copy OR a bridge, never both and never neither.
  //
  // Be honest about what this is: it is not an assertion about call order, and
  // it cannot be — `classify()` and `dialXml()` are module-private. It is a
  // structural invariant over every verdict, which is the strongest pin
  // available while one response body holds the whole decision. It is what
  // would catch a future screen-then-bridge design where a <Gather> and a
  // <Dial> could legitimately coexist in one document. The ordering itself is
  // proven by the mutation in Step 5, not by this test.
  const cases: [string, () => void][] = [
    ["unknown number", () => lookupMock.mockResolvedValue(null)],
    ["disabled profile", () => profileMock.mockResolvedValue({ ...profile, enabled: false })],
    ["over the cap", () => callerCountMock.mockResolvedValue(9)],
    ["repeat offender", () => historyMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 })],
    ["allowed", () => {}],
  ];

  for (const [name, arrange] of cases) {
    it(`${name}: exactly one of refusal-copy or <Dial> is present`, async () => {
      arrange();
      const xml = await get({ To: "+19565061545", From: "+19565550301" });
      const refused = xml.includes("<Say");
      const bridged = xml.includes("<Dial");
      expect(refused !== bridged).toBe(true);
    });
  }
});
```

Adapt `get(...)`, `historyMock`, `lookupMock`, `profileMock`, `callerCountMock`, `profile` and the account id (`"acct_1"`) to the names and helpers the file already uses — read `:1-40` and reuse them rather than introducing a parallel harness.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd apps/web && npx vitest run src/app/api/voice/texml/route.test.ts -t "Guard 2"
```

Expected: FAIL — the blocked caller gets a `<Dial>`.

Confirm the run reports the expected number of tests, not 0 with everything skipped.

- [ ] **Step 3: Write the implementation**

**3a.** Extend the `Routability` union (`:24-27`):

```ts
type Routability =
  | { kind: "dial" }
  | { kind: "refuse"; languages: Languages }
  | { kind: "cap"; languages: Languages };
```

becomes:

```ts
type Routability =
  | { kind: "dial" }
  | { kind: "refuse"; languages: Languages }
  | { kind: "cap"; languages: Languages }
  // A caller whose whole recent history on this account is silent calls.
  // Speaks the SAME sentence as `refuse` on purpose — a robot learns nothing
  // from a distinct message, and a human who has somehow been caught by this
  // is told to try again later, which the rolling window makes true. Only the
  // log line distinguishes the reason.
  | { kind: "blocked"; languages: Languages };
```

**3b.** Add the imports to the lazy import block inside `classify()`'s `try` (`:56-59`), beside the existing ones:

```ts
    const {
      serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince,
      countCallsByCallerSince, countCallerHistorySince,
    } = await import("@bis/db");
    const { readLimitConfig, decideLimit, utcDayStart } = await import("@/lib/voice/call-limits");
    const {
      readReputationConfig, decideReputation, windowStart,
    } = await import("@/lib/voice/caller-reputation");
```

**3c.** Replace the inner cap block (`:88-103`) with one that reads reputation alongside the two cap counts:

```ts
    // Cap and reputation UX only — the caller deserves words, not dead air.
    // The incoming webhook re-checks BOTH with the same shared predicates and
    // stays authoritative, so a stale count here (or the reads racing an
    // in-flight call) can only ever waste a dial attempt, never let a caller
    // through who should have been refused.
    try {
      const now = new Date();
      const dayStart = utcDayStart(now);
      const repCfg = readReputationConfig();
      // Independent reads — run them together, this route sits on Telnyx's
      // carrier answer-deadline. The third read joins the existing pair
      // rather than following them, so Guard 2 costs no wall-clock at all.
      const [forAccount, forNumber, history] = await Promise.all([
        countCallsSince(db, row.account_id, dayStart),
        callerE164 ? countCallsByCallerSince(db, row.account_id, callerE164, dayStart) : Promise.resolve(0),
        callerE164
          ? countCallerHistorySince(db, row.account_id, callerE164, windowStart(now, repCfg.windowDays))
          : Promise.resolve({ spamCalls: 0, otherCalls: 0 }),
      ]);
      // Reputation first: a caller we already know to be a robot should not
      // be described by the day's volume. It is also the more actionable log
      // line of the two.
      const reputation = decideReputation(history, repCfg);
      if (reputation.blocked) {
        console.log(`texml declined blocked (${reputation.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return { kind: "blocked", languages: profile.languages };
      }
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        console.log(`texml declined cap (${verdict.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return { kind: "cap", languages: profile.languages };
      }
    } catch (e) {
      console.error(`texml cap/reputation count failed for ${calledE164}: ${String(e)}`); // fail open
    }
```

**3d.** Branch in `respond()` (`:170-175`), above the bridge:

```ts
  if (calledE164) {
    const result = await classify(calledE164, callerE164);
    if (result.kind === "refuse") return xmlResponse(sayXml(result.languages, COPY.refuse));
    if (result.kind === "blocked") return xmlResponse(sayXml(result.languages, COPY.refuse));
    if (result.kind === "cap") return xmlResponse(sayXml(result.languages, COPY.cap));
    // kind === "dial" → fall through to the same dial path as calledE164===null
  }
  return xmlResponse(dialXml(calledE164));
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd apps/web && npx vitest run src/app/api/voice/texml/route.test.ts
```

Expected: PASS — the whole file, including all 30-odd pre-existing tests.

- [ ] **Step 5: Prove the tests by mutation — including the ordering**

| Mutation in `texml/route.ts` | Test that must fail |
|---|---|
| **Move the `if (result.kind === "blocked")` branch BELOW `return xmlResponse(dialXml(calledE164))` in `respond()`** | `a caller with nothing but silent calls is refused ...` — **this is the ordering proof the spec asks for. Record its exact failure message in the ledger.** |
| Delete the `reputation.blocked` branch from `classify()` | `a caller with nothing but silent calls is refused ...` |
| Change `COPY.refuse` to `COPY.cap` in the `blocked` branch | `uses the EXISTING refusal copy ...` |
| Move the reputation read out of `Promise.all` into its own `await` before the `try` | `the history read failing fails OPEN ...` |
| Make the `blocked` branch return `{ kind: "dial" }` | every test in the mutual-exclusion block for `repeat offender` |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/voice/texml/route.ts apps/web/src/app/api/voice/texml/route.test.ts
git commit -m "feat(voice): refuse a repeat silent caller before the SIP bridge"
```

---

### Task 6: Enforce the same verdict in the webhook

**Files:**
- Modify: `apps/web/src/app/api/voice/incoming/route.ts` (step 8, the caps block at `:457-475`)
- Modify: `apps/web/src/app/api/voice/incoming/route.test.ts` (the step-8 suite at `:260-285`)

**Interfaces:**
- Consumes: `readReputationConfig`, `decideReputation`, `windowStart` (Task 3); `countCallerHistorySince` (Task 4).
- Produces: nothing.

**Why this task exists at all.** `accept-gate.ts:13-17` states the rule: the TeXML route is the UX layer and the webhook is the enforcement layer, and both call ONE predicate so they cannot drift. Guard 2 in TeXML alone would invert that — the OpenAI SIP endpoint is reachable by anyone who knows `VOICE_OPENAI_PROJECT_ID`, which is exactly why the webhook re-checks tenancy, the profile and the caps today. Follow the caps' shape here, including their sequential awaits and their fail-open catch; do not restructure step 8.

A decline here is **silent** — expressed by returning 200 and never calling `acceptCall` (`:52-53`). Nothing is billed before `:557`.

- [ ] **Step 1: Write the failing tests**

Add to the step-8 suite in `apps/web/src/app/api/voice/incoming/route.test.ts`, matching the file's existing decline assertions (`expect(fetchMock).not.toHaveBeenCalled()` and `expect(afterMock).not.toHaveBeenCalled()` — the pair that proves no accept and no lifecycle followed):

```ts
  it("step 8: a repeat silent caller is declined — never accepted, no lifecycle", async () => {
    historyMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("step 8: the same caller WITH a good outcome is accepted — the two gates agree", async () => {
    // The identical history the TeXML test feeds its own gate. If these two
    // ever disagree, the shared predicate has been bypassed on one side.
    historyMock.mockResolvedValue({ spamCalls: 4, otherCalls: 13 });
    await POST(webhookRequest());
    expect(fetchMock).toHaveBeenCalled();
  });

  it("step 8: the history read failing fails OPEN — the call is accepted", async () => {
    historyMock.mockRejectedValue(new Error("boom"));
    await POST(webhookRequest());
    expect(fetchMock).toHaveBeenCalled();
  });
```

Add `countCallerHistorySince` to the file's `@bis/db` mock and default it to `{ spamCalls: 0, otherCalls: 0 }` so every existing test is unaffected.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd apps/web && npx vitest run src/app/api/voice/incoming/route.test.ts -t "step 8"
```

Expected: FAIL — the blocked caller is accepted.

- [ ] **Step 3: Write the implementation**

**3a.** Add `countCallerHistorySince` to the `@bis/db` import at the top of the file, and add beside the existing `@/lib/voice/*` imports:

```ts
import { readReputationConfig, decideReputation, windowStart } from "@/lib/voice/caller-reputation";
```

**3b.** Replace step 8 (`:457-475`) in full. This keeps the block's existing decide-inside-try / act-after-try shape — the flag is set inside so a throw cannot skip past a decline, and the decline is returned outside so the fail-open `catch` covers only the counting:

```ts
    // --- Step 8: abuse caps + caller reputation, fail-open on a counting
    // failure ---------------------------------------------------------------
    // Reputation is the SAME predicate the TeXML route speaks its refusal
    // from (`caller-reputation.ts`), enforced here. TeXML is the UX layer and
    // gives the caller words; this is the layer that makes the decision
    // binding — exactly the split `callAnswerable` already documents, and the
    // reason the OpenAI SIP endpoint being reachable by anyone who knows the
    // project id does not matter. A decline is expressed by never accepting,
    // so nothing is billed.
    let capsAllowed = true;
    let capsReason: "per-number" | "per-account" | undefined;
    let blocked = false;
    let blockReason: "repeat-spam" | undefined;
    try {
      const dayStart = utcDayStart(now);
      const forAccount = await countCallsSince(db, accountId, dayStart);
      const forNumber = callerNumber ? await countCallsByCallerSince(db, accountId, callerNumber, dayStart) : 0;
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        capsAllowed = false;
        capsReason = verdict.reason;
      }
      if (callerNumber) {
        const repCfg = readReputationConfig();
        const history = await countCallerHistorySince(
          db, accountId, callerNumber, windowStart(now, repCfg.windowDays),
        );
        const reputation = decideReputation(history, repCfg);
        if (reputation.blocked) {
          blocked = true;
          blockReason = reputation.reason;
        }
      }
    } catch (e) {
      log("call-limit counts failed — failing open", { callId, accountId, error: String(e) });
    }
    // Reputation before the cap: a caller already known to be a robot should
    // not be described by the day's volume, and it is the more actionable of
    // the two log lines. Matches the TeXML route's own ordering.
    if (blocked) {
      log("declined: blocked caller", { callId, accountId, reason: blockReason });
      return NextResponse.json({ ok: true, declined: blockReason });
    }
    if (!capsAllowed) {
      log("declined: call cap", { callId, accountId, reason: capsReason });
      return NextResponse.json({ ok: true, declined: capsReason });
    }
```

Note `now` is already in scope here (the caps block uses it for `utcDayStart(now)`), so the window floor and the day floor are computed from one instant rather than two.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd apps/web && npx vitest run src/app/api/voice/incoming/route.test.ts
```

Expected: PASS — the whole file.

- [ ] **Step 5: Prove the tests by mutation**

| Mutation in `incoming/route.ts` | Test that must fail |
|---|---|
| Delete the `reputation.blocked` decline | `step 8: a repeat silent caller is declined ...` |
| Move the reputation read outside the fail-open `try` | `step 8: the history read failing fails OPEN ...` |
| Change `decideReputation(history, repCfg)` to ignore `otherCalls` (pass `{ ...history, otherCalls: 0 }`) | `step 8: the same caller WITH a good outcome is accepted ...` |
| Drop the `if (callerNumber)` guard | expect a failure in an existing anonymous-caller test; if none fails, say so plainly rather than claiming coverage |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/voice/incoming/route.ts apps/web/src/app/api/voice/incoming/route.test.ts
git commit -m "feat(voice): make the repeat-caller refusal binding at the webhook"
```

---

### Task 7: Gates, and the one thing only a real call can settle

**Files:** none modified unless a gate fails.

**Interfaces:** consumes everything; produces the PR.

- [ ] **Step 1: Run the three merge gates, ONE AT A TIME**

Never in parallel — they share the one Supabase project, which also serves production. Capture each exit code to a file and read it; do not infer a pass from scrolled output.

```bash
pnpm check                    # typecheck + lint + db tests + web tests
pnpm --filter web build
pnpm --filter web test:e2e
```

Expected: exit 0 from each. Record the db and web file/test totals and the e2e pass count.

- [ ] **Step 2: Verify the caller-audio event vocabulary on a real call**

**This is the one assumption in the feature that no test can settle**, and it must not be hand-waved. `isCallerAudioEvent` accepts the whole `input_audio_buffer.` namespace on the expectation that the Realtime API emits it under `semantic_vad` (this deployment's default — `PHONE_TURN_DETECTION` is unset). If it does not, the guard still works through its backstop, `conversation.item.input_audio_transcription.completed`, but the cancel arrives a full turn later, and a talkative caller could in principle be cut off.

Add one temporary log line in `handleMessage` recording every `event.type`, deploy to a preview, place **two** real calls to the testing number `+19565061545`:

1. Speak immediately. Confirm which event type arrived first and that the call was NOT cut at 30s.
2. Say nothing. Confirm the call ends at ~30s, the recorded outcome is `spam`, and the `calls` row carries no summary.

Then remove the temporary log line. Report the observed event types verbatim in the ledger. **If `input_audio_buffer.*` never appears, raise the default `PHONE_MAX_SILENT_SECONDS` before shipping and say so** — do not leave a guard tuned for a signal that is not arriving.

This mirrors the `sipHeaderNames` log-read step the voice runbook already prescribes for exactly this class of unknown.

- [ ] **Step 3: Open the PR**

Push the branch and open a PR against `main` titled **"Stop paying to talk to robots"**. The body must state: the two guards and what each bounds; the worst case going 20 min → 2.5 min → zero; that no migration was needed; that the caps still fail open and why Guard 1 strengthens rather than weakens that decision; and the real-call verification result from Step 2.

If `gh pr create` reports a GraphQL rate limit while `gh api rate_limit` shows quota remaining, it is a secondary abuse limit — use the REST endpoint instead: `gh api repos/{owner}/{repo}/pulls -X POST -F body=@file`.

- [ ] **Step 4: Do not merge until both checks are green ON THE PR's HEAD SHA**

Read the check runs pinned to the head commit — `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` — and confirm `verify` and `e2e` both report `success` with a `head_sha` matching. Do not infer it from the PR summary and do not infer it from an earlier run. Nothing server-side enforces this.

---

## Self-Review

**Spec coverage.** Guard 1 → Tasks 1–2. Guard 2 → Tasks 3–6. The shared-predicate requirement → Tasks 3, 5, 6. Zero-good-outcomes clause → Task 3 Step 1 and Task 4. `turn_count: 0` exclusion → Task 4. Rolling window → Tasks 3 and 4. No new copy → Task 5. Fail-open everywhere → Tasks 5 and 6. Constrained goodbye, cap untouched → Tasks 1 and 2. The ordering pin → Task 5 Steps 1 and 5. No migration → Global Constraints and Task 4. Env var documentation → Tasks 1 and 3. Rollout / real-call verification → Task 7.

**Deliberately not in any task,** because the spec places them out of scope: answer-and-gather screening; a per-account spend budget; carrier spam scoring; inbound-text spam; surfacing refused calls in the UI (named in the spec as an accepted property with a follow-up, not part of this work).

**Type consistency.** `CallerHistory` in Task 3 is `{ spamCalls: number; otherCalls: number }`, which is exactly what `countCallerHistorySince` returns in Task 4 and exactly what Tasks 5 and 6 pass to `decideReputation`. `ReputationConfig` is `{ threshold, windowDays }` throughout. `windowStart(now: Date, windowDays: number): string` takes the config's field, not the config. `silenceGoodbye` takes `"en" | "es" | "both"`, matching `VoiceProfileRow.languages` (`packages/db/src/voice.ts:13`) and the local `Languages` alias in the TeXML route. `Routability` gains `blocked`, carrying `languages` like its two siblings.
