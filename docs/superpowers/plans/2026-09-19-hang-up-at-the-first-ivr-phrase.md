# Hang Up at the First IVR Phrase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End a robocall the moment its transcript-so-far reads as a recording, instead of after the recording has finished — so each one bills seconds, not the better part of a minute.

**Architecture:** Today `processCallEvent` (`apps/web/src/lib/voice/call-events.ts:96`) judges a caller turn only on `conversation.item.input_audio_transcription.completed`, which the Realtime API emits once the whole turn is transcribed. `semantic_vad` lands a robot's entire script as ONE turn, so the guard fires at the moment the robot would have hung up anyway — #88 fixed the label, not the bill (09-17 without the guard and 09-18 with it both cost 38–56s). This plan subscribes to the incremental `conversation.item.input_audio_transcription.delta` event the same API emits while the caller is still talking, accumulates the growing prefix per `item_id` in `CallState`, and runs the SAME predicate (`looksLikeRecordedMessage`, unchanged) against the prefix. The first delta on which the prefix passes produces the same `{ kind: "hangup" }` action the lifecycle already consumes. Nothing about the predicate, the lifecycle's hangup handling, or the session config changes.

**Tech Stack:** TypeScript, vitest, the OpenAI Realtime WS (`openai@6.49.0` types `ConversationItemInputAudioTranscriptionDeltaEvent` at `node_modules/.pnpm/openai@6.49.0_ws@8.21.3_zod@4.4.3/node_modules/openai/resources/realtime/realtime.d.ts:348` — fields `item_id`, `delta`, optional `content_index`). Input transcription is already on for every session (`apps/web/src/lib/voice/session-config.ts:36`, model `gpt-4o-mini-transcribe`), which is what makes `.completed` arrive today and what makes `.delta` arrive.

## Global Constraints

- **The predicate does not change.** `looksLikeRecordedMessage` in `apps/web/src/lib/voice/recorded-message.ts:87-91` keeps BOTH conditions — `MIN_LENGTH = 120` AND (`IVR_INSTRUCTION` or `OPT_OUT`) — and is called with the prefix exactly as it is called with the full turn today. No new heuristic, no new keyword, and **never keyed on "Google"** (`recorded-message.ts:41-48` explains why; the negatives in `recorded-message.test.ts:77-125` are the proof and stay untouched).
- **The turn is recorded before the hangup, prefix included.** `call-events.ts:100-103`: "a spam row with an empty transcript is indistinguishable from a silent call." On a delta-triggered hangup the caller turn written to `state.transcript` is the prefix that tripped the guard, `role: "caller"`.
- **No goodbye, no reply, ends the SIP leg.** The action is the existing `{ kind: "hangup" }`; the lifecycle (`apps/web/src/app/api/voice/incoming/route.ts:627-659`) clears every timer, calls `endCallLeg`, closes the socket, and never sends. This plan must not add a second ending path.
- **A real caller is never cut.** Both negatives below are fed word by word and must never produce `hangup` at ANY prefix length: the "found you on Google" caller (`recorded-message.test.ts:88-92`) and the long rambling customer (`recorded-message.test.ts:117-123`).
- **Mutation proof for the negatives.** Weakening the predicate to length-only (delete the `IVR_INSTRUCTION.test(t) || OPT_OUT.test(t)` clause, return `true` past the floor) MUST turn the prefix negatives red. Run it, record the failing test names, revert. A negative that survives that mutation is not a negative.
- **Gates run ONE AT A TIME**, exit codes read from files: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. Before `pnpm check` or e2e, run `gh run list --limit 3` and wait for any in-progress CI run — the db suite, the e2e suite, CI and production share ONE Supabase project.
- **Branch `feat/hang-up-at-the-first-ivr-phrase`**, already created from main `4442fb2` with this plan on it. Commit per task; do not push (the controller pushes after review).
- Commit trailer, verbatim, on every commit:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF`
- **Estimate, labelled as one:** in the real script the first IVR instruction SHAPE ("Press 0 to" — the predicate needs the digit and the connective, not the verb after it) lands about 240 characters in, at word 40 of 80 — a hangup there cuts roughly the last half of the monologue plus Sofía's reply. The measured number comes from the next real call, not from this plan.

---

## File Structure

- **Modify** `apps/web/src/lib/voice/call-state.ts` — `CallState` gains `pendingCallerTurn`; two pure helpers, `withCallerDelta` and `clearPendingCallerTurn`. This file owns call state; the buffer is call state.
- **Modify** `apps/web/src/lib/voice/call-state.test.ts` — unit tests for the two helpers.
- **Modify** `apps/web/src/lib/voice/call-events.ts` — `RealtimeCallEvent` gains `item_id`/`delta`; a new `case` for the delta event; the `.completed` case clears the pending buffer. This file is the pure seam that already owns the judgement.
- **Modify** `apps/web/src/lib/voice/call-events.test.ts` — the prefix positives and negatives, word by word.
- **Modify** `apps/web/src/lib/voice/recorded-message.ts` — header comment only: the "label, not the bill" paragraph, so the next reader knows why the delta path exists.
- **Modify** `apps/web/src/app/api/voice/incoming/lifecycle.test.ts` — the same proof at the socket layer: deltas over the fake WS end the call before any `.completed` frame; the negative at that layer.
- **Modify** `docs/superpowers/specs/2026-09-15-spam-screening-design.md` — a dated addendum recording the decision (Option B) and what it does not do.
- **No change** to `apps/web/src/app/api/voice/incoming/route.ts`: the dispatch loop at `:619` already hands every frame to `processCallEvent` and consumes `hangup` at `:627`. If Task 3's lifecycle test cannot pass without touching it, that is a DONE_WITH_CONCERNS, not a silent edit.

---

### Task 1: The pending caller turn lives in `CallState`

**Files:**
- Modify: `apps/web/src/lib/voice/call-state.ts:64-88` (the `CallState` interface and `emptyCallState`), plus two new exported functions next to `withTranscript` (`:143`)
- Test: `apps/web/src/lib/voice/call-state.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, for Task 2:
  ```ts
  // on CallState
  pendingCallerTurn: { itemId: string; text: string } | null;
  // helpers
  export function withCallerDelta(state: CallState, itemId: string, delta: string): CallState;
  export function clearPendingCallerTurn(state: CallState): CallState;
  ```
  `withCallerDelta` appends `delta` to the pending text when `itemId` matches the pending item; when the pending item is a DIFFERENT `itemId` (or there is none) it starts a fresh buffer with just `delta`. `clearPendingCallerTurn` sets the field to `null`. Both are pure: no mutation of the input state.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/voice/call-state.test.ts` (it already imports `emptyCallState` and the `with*` helpers from `./call-state`; add `withCallerDelta` and `clearPendingCallerTurn` to that import):

```ts
describe("pendingCallerTurn — the growing prefix of the caller's in-flight turn", () => {
  it("starts empty", () => {
    expect(emptyCallState().pendingCallerTurn).toBeNull();
  });

  it("appends deltas for the same item in order", () => {
    let s = withCallerDelta(emptyCallState(), "item_1", "Hello, ");
    s = withCallerDelta(s, "item_1", "please ");
    s = withCallerDelta(s, "item_1", "don't hang up.");
    expect(s.pendingCallerTurn).toEqual({ itemId: "item_1", text: "Hello, please don't hang up." });
  });

  it("a delta for a different item starts over — the previous item's prefix is not carried", () => {
    // Two caller turns never interleave on one socket, but the buffer must
    // be keyed anyway: a stale prefix from turn 1 glued onto turn 2 could
    // cross the length floor on words the caller never said together.
    let s = withCallerDelta(emptyCallState(), "item_1", "first turn text");
    s = withCallerDelta(s, "item_2", "second");
    expect(s.pendingCallerTurn).toEqual({ itemId: "item_2", text: "second" });
  });

  it("clearing leaves every other field alone", () => {
    const before = withCallerDelta(emptyCallState(), "item_1", "abc");
    const after = clearPendingCallerTurn(before);
    expect(after.pendingCallerTurn).toBeNull();
    expect({ ...after, pendingCallerTurn: before.pendingCallerTurn }).toEqual(before);
  });

  it("is pure — the input state is not mutated", () => {
    const s0 = emptyCallState();
    const s1 = withCallerDelta(s0, "item_1", "abc");
    expect(s0.pendingCallerTurn).toBeNull();
    expect(s1).not.toBe(s0);
  });

  it("clearing is pure — the input keeps its pending turn and the result is a new object", () => {
    // Added after review: a MUTATING clearPendingCallerTurn
    // (`state.pendingCallerTurn = null; return state;`) passed every test
    // above, because "clearing leaves every other field alone" compares an
    // object to itself once the input is mutated in place. A purity test
    // must pin the INPUT's own field and the result's identity.
    const before = withCallerDelta(emptyCallState(), "item_1", "abc");
    const pendingBefore = before.pendingCallerTurn;
    const after = clearPendingCallerTurn(before);
    expect(after).not.toBe(before);
    expect(before.pendingCallerTurn).toBe(pendingBefore);
    expect(before.pendingCallerTurn).toEqual({ itemId: "item_1", text: "abc" });
    expect(after.pendingCallerTurn).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/voice/call-state.test.ts`
Expected: FAIL — `withCallerDelta is not a function` / `pendingCallerTurn` undefined. Record the exact failing lines in the report (RED evidence).

- [ ] **Step 3: Implement**

In `apps/web/src/lib/voice/call-state.ts`, add the field to the interface (after `recordedCaller: boolean;` at `:79`):

```ts
  /**
   * The caller's IN-FLIGHT turn, as far as the transcriber has got.
   *
   * The Realtime API streams `conversation.item.input_audio_transcription.delta`
   * frames while the caller is still speaking and one `.completed` frame when
   * they stop. Until this existed the recording guard (`recorded-message.ts`)
   * could only judge the `.completed` text — which, for a robot delivering a
   * 470-character script as one turn, arrives at the moment the robot would
   * have hung up anyway. #88 fixed the label, not the bill. This buffer is
   * what lets `call-events.ts` judge the prefix instead.
   *
   * Keyed by `itemId` so a stale prefix from one turn is never glued onto the
   * next. `null` between turns. Never read by classifyOutcome.
   */
  pendingCallerTurn: { itemId: string; text: string } | null;
```

Update `emptyCallState` (`:83-88`) to include `pendingCallerTurn: null`.

Add the two helpers directly after `withTranscript` (`:145`):

```ts
/**
 * Appends one transcription delta to the in-flight caller turn. A delta for a
 * DIFFERENT item starts a fresh buffer — the previous turn's text is not
 * carried, because it was never part of this utterance.
 */
export function withCallerDelta(state: CallState, itemId: string, delta: string): CallState {
  const pending = state.pendingCallerTurn;
  const text = pending && pending.itemId === itemId ? pending.text + delta : delta;
  return { ...state, pendingCallerTurn: { itemId, text } };
}

/** The turn has been completed (or the call ended) — nothing is in flight. */
export function clearPendingCallerTurn(state: CallState): CallState {
  return { ...state, pendingCallerTurn: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass, and the file's existing tests still do**

Run: `pnpm --filter web exec vitest run src/lib/voice/call-state.test.ts`
Expected: PASS, all tests in the file. Then typecheck the workspace, because `emptyCallState` is constructed in other tests and any literal `CallState` object elsewhere now needs the field:

Run: `pnpm --filter web exec tsc --noEmit -p .`
Expected: clean. If any test builds a `CallState` literal by hand (grep `recordedCaller: false` under `apps/web/src`), add `pendingCallerTurn: null` to it in this task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/voice/call-state.ts apps/web/src/lib/voice/call-state.test.ts
git commit -F - <<'MSG'
feat(voice): keep the caller's in-flight turn in call state

The recording guard can only judge text it has been handed. Today that
is the completed turn — for a robot reading a 470-character script as one
turn, the moment the robot would have hung up anyway. This is the buffer
that lets the next commit judge the growing prefix instead: keyed by the
Realtime item id so one turn's words are never glued onto the next, pure,
and never read by classifyOutcome.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
MSG
```

---

### Task 2: Judge the prefix on every delta

**Files:**
- Modify: `apps/web/src/lib/voice/call-events.ts:28-34` (`RealtimeCallEvent`), `:96-114` (the `.completed` case; add the `.delta` case beside it)
- Modify: `apps/web/src/lib/voice/recorded-message.ts:1-33` (header comment only)
- Test: `apps/web/src/lib/voice/call-events.test.ts`

**Interfaces:**
- Consumes from Task 1: `withCallerDelta(state, itemId, delta)`, `clearPendingCallerTurn(state)`, `state.pendingCallerTurn`.
- Produces: the existing `{ kind: "hangup" }` action, now also from a `.delta` frame. No new action kinds. `RealtimeCallEvent` gains `item_id?: string; delta?: string;`.

**Behaviour, exactly:**
1. On `conversation.item.input_audio_transcription.delta` with a non-empty `delta` string and an `item_id`: `next = withCallerDelta(state, item_id, delta)`. If `looksLikeRecordedMessage(next.pendingCallerTurn.text)` is true: append the PREFIX to the transcript as a caller turn, mark `recordedCaller`, clear the pending buffer, return `[{ kind: "hangup" }]`. Otherwise return `next` with no actions. A delta with no `item_id` or an empty `delta` is ignored (return `state`, no actions).
2. On `conversation.item.input_audio_transcription.completed`: behaviour is exactly today's (`:96-114`), plus `clearPendingCallerTurn` on whichever state is returned. The completed text supersedes the prefix; nothing from the buffer is appended here.
3. `recordedCaller` already true (a prior delta hung up) — no further frame can arrive, because the lifecycle closes the socket synchronously on `hangup`. No special case; do not add one.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/voice/call-events.test.ts`, inside the top-level `describe("processCallEvent", …)`:

```ts
  // ── The prefix is judged while the robot is still talking ─────────────
  const ROBOCALL =
    "Hello, please don't hang up the phone. This is an important message "
    + "regarding your Google business account. Our system shows a new search for "
    + "your business via Google, and Google Voice clients are currently having "
    + "trouble finding you. Press 0 to speak with an agent immediately and verify "
    + "your Google listing. Again, your business is not showing correctly on Google "
    + "and Google Voice search. Press 0 to speak to an agent, press 9 to opt out, "
    + "or call 877-556-9255. Thank you.";

  /** Feeds `text` one word at a time as delta frames for `itemId`, returning
   *  the index of the FIRST delta that produced a hangup (or -1), the state
   *  after the last frame processed, and the number of frames processed. */
  async function feedWordByWord(text: string, itemId = "item_1") {
    const words = text.split(" ");
    let state = emptyCallState();
    for (let i = 0; i < words.length; i++) {
      const delta = (i === 0 ? "" : " ") + words[i];
      const r = await processCallEvent(state, ctx,
        { type: "conversation.item.input_audio_transcription.delta", item_id: itemId, delta });
      state = r.state;
      if (r.actions.some((a) => a.kind === "hangup")) {
        expect(r.actions).toEqual([{ kind: "hangup" }]);
        return { hungUpAt: i, state, frames: i + 1, words };
      }
    }
    return { hungUpAt: -1, state, frames: words.length, words };
  }

  it("hangs up on the delta where the prefix first reads as a recording — not after the script ends", async () => {
    const { hungUpAt, state, words } = await feedWordByWord(ROBOCALL);
    expect(hungUpAt).toBeGreaterThan(-1);
    // Strictly before the last word: the whole point is not waiting for
    // the recording to finish.
    expect(hungUpAt).toBeLessThan(words.length - 1);
    // And exactly where the FIRST IVR instruction's SHAPE completes. The
    // predicate is `press <digit> (to|for|and|if)` — it needs "Press 0 to",
    // not the verb after it — so the hangup lands on "to", before "speak
    // with an agent" has even been said. (The plan first assumed the longer
    // phrase; the implementer's RED run corrected it: word 40 of 80.)
    const prefix = words.slice(0, hungUpAt + 1).join(" ");
    expect(prefix).toMatch(/Press 0 to$/i);
    expect(prefix).not.toMatch(/agent/i);
    expect(state.recordedCaller).toBe(true);
  });

  it("records the prefix that tripped it as the caller turn — the evidence, same rule as .completed", async () => {
    const { state, words, hungUpAt } = await feedWordByWord(ROBOCALL);
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({
      role: "caller", text: words.slice(0, hungUpAt + 1).join(" "),
    });
    expect(state.pendingCallerTurn).toBeNull();
  });

  it("a customer who found them on Google is never cut, at any prefix length", async () => {
    // The negative that matters most, now at every word boundary. The
    // sentence is past MIN_LENGTH by the end, so only the ABSENCE of a
    // Google rule and the PRESENCE of the phrase rule keep it false.
    const { hungUpAt, state } = await feedWordByWord(
      "Hi there, I found you on Google when I was searching for custom furniture "
      + "makers around McAllen, and your photos looked great. I wanted to ask about "
      + "getting a dining table made for eight people, in oak if you have it.");
    expect(hungUpAt).toBe(-1);
    expect(state.recordedCaller).toBe(false);
    expect(state.transcript).toEqual([]);      // nothing appended until .completed
  });

  it("a long rambling customer is never cut, at any prefix length", async () => {
    const { hungUpAt } = await feedWordByWord(
      "Hi there, so my wife and I have been talking about redoing the kitchen for "
      + "about two years now and we finally decided to go ahead with it, and someone "
      + "at church mentioned that you all do custom cabinets, so I wanted to call and "
      + "see whether you could come out and take a look and give us some idea of what "
      + "something like that would run, because we have no idea what to expect really.");
    expect(hungUpAt).toBe(-1);
  });

  it(".completed after a clean run of deltas appends the full turn once and clears the buffer", async () => {
    const { state: afterDeltas } = await feedWordByWord("Hi, I found you on Google and wanted to ask about a dining table.");
    const { state, actions } = await processCallEvent(afterDeltas, ctx,
      { type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_1",
        transcript: "Hi, I found you on Google and wanted to ask about a dining table." });
    expect(actions).toEqual([]);
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ role: "caller",
      text: "Hi, I found you on Google and wanted to ask about a dining table." });
    expect(state.pendingCallerTurn).toBeNull();
  });

  it("a delta with no item_id or no text is ignored", async () => {
    const s0 = emptyCallState();
    const a = await processCallEvent(s0, ctx,
      { type: "conversation.item.input_audio_transcription.delta", delta: "hello" });
    const b = await processCallEvent(s0, ctx,
      { type: "conversation.item.input_audio_transcription.delta", item_id: "item_1", delta: "" });
    expect(a).toEqual({ state: s0, actions: [] });
    expect(b).toEqual({ state: s0, actions: [] });
  });

  it("deltas for a new item never inherit the previous item's prefix", async () => {
    // Turn 1 is a long, harmless customer sentence; turn 2's first delta
    // alone is far under the floor. If the buffer leaked across items, turn
    // 2 would be judged on ~250 characters it never said.
    const { state: afterTurn1 } = await feedWordByWord(
      "Hi there, I found you on Google when I was searching for custom furniture "
      + "makers around McAllen, and your photos looked great. I wanted to ask about "
      + "getting a dining table made for eight people, in oak if you have it.", "item_1");
    const r = await processCallEvent(afterTurn1, ctx,
      { type: "conversation.item.input_audio_transcription.delta", item_id: "item_2", delta: "press 9 to opt out" });
    expect(r.actions).toEqual([]);
    expect(r.state.pendingCallerTurn).toEqual({ itemId: "item_2", text: "press 9 to opt out" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/voice/call-events.test.ts`
Expected: the seven new tests FAIL (the delta type is unknown to the switch, so `hungUpAt` is -1 where a hangup is expected, `.completed` leaves `pendingCallerTurn` set, etc.). Record the failing names (RED evidence). Existing tests in the file still pass.

- [ ] **Step 3: Implement**

`apps/web/src/lib/voice/call-events.ts` — extend the import from `./call-state`:

```ts
import {
  withTranscript, withRecordedCaller, withCallerDelta, clearPendingCallerTurn, type CallState,
} from "./call-state";
```

Extend `RealtimeCallEvent` (`:28-34`):

```ts
export interface RealtimeCallEvent {
  type?: string;
  transcript?: string;
  arguments?: string;
  name?: string;
  call_id?: string;
  /** `conversation.item.input_audio_transcription.delta` only — see that case. */
  item_id?: string;
  delta?: string;
}
```

Add the new case IMMEDIATELY BEFORE the `.completed` case (`:96`):

```ts
    case "conversation.item.input_audio_transcription.delta": {
      // THE PREFIX IS JUDGED, NOT THE FINISHED TURN. The `.completed` case
      // below is where this guard lived first (#88), and it was correct —
      // and it fired at the moment the robot would have hung up anyway,
      // because semantic_vad lands a 470-character script as ONE turn and
      // `.completed` arrives only when that turn is over. Calls with and
      // without the guard both cost 38–56 seconds; #88 fixed the label, not
      // the bill. This case runs the SAME predicate against the transcript
      // as far as it has got, so the hangup lands at the first "press 0 to
      // speak with an agent" instead of at "thank you".
      //
      // Same predicate, same two conditions, same negatives — see
      // recorded-message.ts for why it is never keyed on "Google". Nothing
      // here widens what counts as a recording; it only moves WHEN the same
      // judgement is made.
      if (!event.item_id || !event.delta) return { state, actions: [] };
      const next = withCallerDelta(state, event.item_id, event.delta);
      const prefix = next.pendingCallerTurn!.text;
      if (!looksLikeRecordedMessage(prefix)) return { state: next, actions: [] };
      // Recorded FIRST, as the prefix — the same evidence rule as below: the
      // words that tripped the guard are the only way a false positive can
      // ever be audited. The buffer is cleared because the turn is over; the
      // socket closes before any `.completed` could arrive for it.
      const recorded = withRecordedCaller(
        withTranscript(clearPendingCallerTurn(next),
          { role: "caller", text: prefix, at: new Date().toISOString() }));
      return { state: recorded, actions: [{ kind: "hangup" }] };
    }
```

Change the `.completed` case so every return clears the buffer — the completed text supersedes whatever prefix was in flight:

```ts
    case "conversation.item.input_audio_transcription.completed": {
      if (!event.transcript) return { state: clearPendingCallerTurn(state), actions: [] };
      const text = String(event.transcript);
      const next = withTranscript(clearPendingCallerTurn(state),
        { role: "caller", text, at: new Date().toISOString() });
      // The turn is ALWAYS recorded first, recording or not. What the robot
      // said is the evidence the guard was right, and the only way anyone can
      // audit a false positive afterwards — a spam row with an empty
      // transcript is indistinguishable from a silent call.
      //
      // Still here, not only in the `.delta` case above: a transcriber that
      // sends no deltas (or a turn whose prefix crossed the floor only on
      // its final word) must still be caught on the finished text.
      if (looksLikeRecordedMessage(text)) {
        // NO GOODBYE, unlike the cap and the silence guard. Those end a call a
        // PERSON is on, where the repo rule is that a caller must never hear
        // the line simply go dead. There is nobody here to hear it: the thing
        // on the other end is a broadcast that has already stopped listening,
        // and a five-second parting sentence is five more seconds of the
        // client paying for it.
        return { state: withRecordedCaller(next), actions: [{ kind: "hangup" }] };
      }
      return { state: next, actions: [] };
    }
```

`apps/web/src/lib/voice/recorded-message.ts` — add one paragraph to the header comment, after the "WHY THE EXISTING GUARDS CANNOT SEE THESE" paragraph (`:16-20`):

```ts
// WHAT #88 DID AND DID NOT DO. It fixed the LABEL — spam, not abandoned —
// and it did not shorten the call, because the predicate below was only
// ever handed the COMPLETED turn, and for a robot that means the moment the
// script ends. Calls before and after it both cost 38–56 seconds. The
// `.delta` case in call-events.ts is what fixes the bill: the same
// predicate, run on the transcript as far as it has got, so the hangup
// lands at the first "press 0" rather than at "thank you".
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/voice/call-events.test.ts src/lib/voice/recorded-message.test.ts src/lib/voice/call-state.test.ts`
Expected: PASS, every test in all three files.

- [ ] **Step 5: Mutation proof — the negatives must be able to fail**

In `apps/web/src/lib/voice/recorded-message.ts:90`, TEMPORARILY replace
`return IVR_INSTRUCTION.test(t) || OPT_OUT.test(t);` with `return true;`.

Run: `pnpm --filter web exec vitest run src/lib/voice/call-events.test.ts`
Expected: FAIL — at minimum "a customer who found them on Google is never cut, at any prefix length" and "a long rambling customer is never cut, at any prefix length" go red (the prefix crosses 120 characters mid-sentence and the mutated predicate says "recording"). Record the exact failing test names in the report. **Revert the mutation** and re-run to confirm green again. If either negative stays GREEN under the mutation, stop: the test is not guarding the claim — report DONE_WITH_CONCERNS with the details rather than proceeding.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/voice/call-events.ts apps/web/src/lib/voice/call-events.test.ts apps/web/src/lib/voice/recorded-message.ts
git commit -F - <<'MSG'
feat(voice): hang up at the first IVR phrase, not after the recording ends

#88 taught the receptionist to recognise a recording and hang up. It
fixed the label — spam, not abandoned — and not the bill: the predicate
was only ever handed the COMPLETED caller turn, and semantic_vad lands a
robot's 470-character script as one turn, so the hangup fired at the
moment the robot would have hung up anyway. Calls with and without the
guard both cost 38–56 seconds on the only real client.

The Realtime API streams the transcript while the caller is still
talking. This subscribes to that delta event, keeps the growing prefix in
call state keyed by item, and runs the SAME predicate — same length
floor, same "press N to…" / "to opt out" shape, still never keyed on
"Google" — on every delta. The first prefix that passes produces the
existing hangup action; the prefix is written as the caller turn first,
because the words that tripped the guard are the only audit trail a
false positive will ever have.

Proven word by word: the real script hangs up at "Press 0 to speak with
an agent", strictly before its last word; the "found you on Google"
caller and the long rambling customer are never cut at any prefix
length; and weakening the predicate to length-only turns both negatives
red (mutation run and reverted).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
MSG
```

---

### Task 3: The socket layer proves it, and the spec records it

**Files:**
- Test: `apps/web/src/app/api/voice/incoming/lifecycle.test.ts` — add to the existing recorded-message `describe` (the block containing the tests at `:1225-1300`, which already has `startLifecycle`, `flushMicrotasks`, `fetchMock`, `hangupCalls` in scope)
- Modify: `docs/superpowers/specs/2026-09-15-spam-screening-design.md` — dated addendum at the end
- Expected NO change: `apps/web/src/app/api/voice/incoming/route.ts`

**Interfaces:**
- Consumes from Task 2: `processCallEvent` now returns `hangup` from a `.delta` frame.
- Produces: nothing new.

- [ ] **Step 1: Write the failing lifecycle tests**

Inside the recorded-message `describe` in `lifecycle.test.ts`, after "an ordinary caller is left alone entirely":

```ts
  const ROBOCALL_WORDS = (
    "Hello, please don't hang up the phone. This is an important message "
    + "regarding your Google business account. Our system shows a new search for "
    + "your business via Google, and Google Voice clients are currently having "
    + "trouble finding you. Press 0 to speak with an agent immediately and verify "
    + "your Google listing. Again, your business is not showing correctly on Google "
    + "and Google Voice search. Press 0 to speak to an agent, press 9 to opt out, "
    + "or call 877-556-9255. Thank you."
  ).split(" ");

  it("ends the call on a DELTA — before the recording finishes and before any .completed frame", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const closeSpy = vi.fn();
    ws.send = vi.fn();
    ws.close = closeSpy;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900);
    fetchMock.mockClear();

    let framesSent = 0;
    for (let i = 0; i < ROBOCALL_WORDS.length; i++) {
      ws.emit("message", JSON.stringify({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "item_1",
        delta: (i === 0 ? "" : " ") + ROBOCALL_WORDS[i],
      }));
      framesSent++;
      await flushMicrotasks();
      if (closeSpy.mock.calls.length > 0) break;
    }
    // Closed strictly before the script's last word was ever delivered.
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(framesSent).toBeLessThan(ROBOCALL_WORDS.length);
    // And the SIP leg ended, exactly as the .completed path does (#84).
    const calls = hangupCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("https://api.openai.com/v1/realtime/calls/call_abc123/hangup");
    // No reply was ever queued to the broadcast.
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("a real caller's deltas never end the call, and their .completed turn is answered normally", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const closeSpy = vi.fn();
    ws.send = vi.fn();
    ws.close = closeSpy;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900);
    fetchMock.mockClear();

    const sentence = "Hi there, I found you on Google when I was searching for custom furniture "
      + "makers around McAllen, and your photos looked great. I wanted to ask about "
      + "getting a dining table made for eight people, in oak if you have it.";
    const words = sentence.split(" ");
    for (let i = 0; i < words.length; i++) {
      ws.emit("message", JSON.stringify({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "item_1",
        delta: (i === 0 ? "" : " ") + words[i],
      }));
      await flushMicrotasks();
    }
    ws.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_1",
      transcript: sentence,
    }));
    await flushMicrotasks();

    expect(closeSpy).not.toHaveBeenCalled();
    expect(hangupCalls()).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail — or pass for the right reason**

Run: `pnpm --filter web exec vitest run src/app/api/voice/incoming/lifecycle.test.ts -t "DELTA|real caller's deltas"`

Expected BEFORE Task 2 is on the branch: the delta test FAILS (no close). On this branch Task 2 IS already committed, so both tests are expected to PASS on first run. That is acceptable ONLY if you confirm the RED by checking out the pre-Task-2 code for the run: `git stash` is not needed — run
`git show HEAD~1:apps/web/src/lib/voice/call-events.ts > /tmp/ce.ts` is NOT the method either; instead temporarily revert the delta case by commenting out its `case` label in `call-events.ts`, run the two tests, confirm the delta test fails with `expected closeSpy to have been called 1 times, received 0`, then restore. Record both runs in the report.

- [ ] **Step 3: Confirm `route.ts` needed no change**

Run: `git status --short apps/web/src/app/api/voice/incoming/route.ts`
Expected: no output. If the delta test could not be made to pass without editing `route.ts`, stop and report DONE_WITH_CONCERNS with the exact reason — the plan's premise is that the dispatch loop at `route.ts:619-659` already routes every frame and consumes `hangup`.

- [ ] **Step 4: Record the decision in the spam-screening spec**

Append to `docs/superpowers/specs/2026-09-15-spam-screening-design.md`:

```markdown

## Addendum 2026-09-19 — hang up at the first IVR phrase (Option B)

**What #88 did and did not do.** It fixed the label — a talking robot is
`spam`, not `abandoned` — and it did not shorten the call. The predicate ran
only on `conversation.item.input_audio_transcription.completed`, and
`semantic_vad` lands a robot's whole ~470-character script as one turn, so
the hangup fired at the moment the robot would have hung up anyway. Measured
on 956 Woodworks: calls on 09-17 (no guard) and 09-18 (guard) both cost
38–56 seconds.

**What changed.** `call-events.ts` now also handles the API's incremental
`…input_audio_transcription.delta` frames, keeps the growing prefix per item
in `CallState.pendingCallerTurn`, and runs the SAME predicate on it. The
first delta whose prefix passes produces the existing `hangup`. The prefix
is written as the caller turn first — the audit trail. No change to the
predicate, the lifecycle, or the session config.

**What was considered and set aside.** (A) A per-account campaign signature —
the reputation rule's own safety condition ("refuse only when the caller's
ENTIRE history is spam") is disarmed by a single real call, and it can do
nothing for a campaign's first call. (C) STIR/SHAKEN attestation before
answering — nothing in the TeXML route reads an attestation field and it is
unconfirmed the carrier surfaces one; a "find out", not a fix.

**What this does not do.** It does not stop the call being answered, and it
does not stop the campaign. It makes each robocall cost roughly the seconds
up to its first "press 0 to" instead of the whole script (estimate: ~240 of
~470 characters in — word 40 of 80, where the predicate's `press <digit>
(to|for|and|if)` shape completes — plus Sofía's reply saved outright; the
real number comes from the next live call, not from this document).

**The rule that still binds.** Never keyed on "Google". Both conditions,
never either. A real caller is never cut: proven word by word in
`call-events.test.ts` and at the socket in `lifecycle.test.ts`, and the
negatives go red when the phrase clause is deleted.
```

- [ ] **Step 5: Run the gates, one at a time, exit codes from files**

Before each Supabase-touching gate: `gh run list --limit 3` — wait for any in-progress run.

1. `pnpm check > "$TMP/check.txt" 2>&1; echo EXIT=$? >> "$TMP/check.txt"` — expected `EXIT=0`, `Test Files … passed`, only the pre-existing `sms/alerts.test.ts` lint warning.
2. `pnpm --filter web build > "$TMP/build.txt" 2>&1; echo EXIT=$? >> …` — expected `EXIT=0`.
3. `pnpm --filter web test:e2e > "$TMP/e2e.txt" 2>&1; echo EXIT=$? >> …` — expected `EXIT=0`, `98 passed`, no `skipped` line.

Record each summary line and exit code in the report.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/voice/incoming/lifecycle.test.ts docs/superpowers/specs/2026-09-15-spam-screening-design.md
git commit -F - <<'MSG'
test(voice): a delta ends the call at the socket, before any .completed

The same proof as call-events.test.ts, one layer down where getting it
wrong hangs up on a lead: the real script's deltas over the fake socket
close it and end the SIP leg strictly before the script's last word and
with no reply queued; a real caller's deltas never do, and their
completed turn is answered as before. route.ts needed no change — the
dispatch loop already routes every frame and consumes hangup.

The spam-screening spec records the decision (Option B), what was set
aside and why, and what this deliberately does not do.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UuVS5XfWB6aZdX9b83RePF
MSG
```

---

## Self-review

**Spec coverage.** Brief §4 recommendation → Tasks 1–3. "Same predicate, same gate" → Global Constraints + Task 2 Step 3 (predicate file untouched except its comment). "Hangup at word N, not after the full script" → Task 2 test 1, Task 3 test 1. "Negative: 'I found you on Google', prefix by prefix, never fires" → Task 2 tests 3–4, Task 3 test 2. "Reverting the phrase check to length-only trips the negative" → Task 2 Step 5. Audit trail (prefix recorded) → Task 2 test 2. Delta event prerequisite → header (SDK path and line). Options A/C set aside → Task 3 Step 4 addendum.

**Placeholder scan.** None. Every code step carries the code.

**Type consistency.** `pendingCallerTurn: { itemId: string; text: string } | null` (Task 1) is what Task 2 reads via `next.pendingCallerTurn!.text` after `withCallerDelta` — non-null by construction there. `withCallerDelta(state, itemId, delta)` and `clearPendingCallerTurn(state)` are named identically in Tasks 1 and 2. `RealtimeCallEvent.item_id`/`.delta` match the SDK field names and the test frames in Tasks 2 and 3.
