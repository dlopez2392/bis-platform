import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runToolMock = vi.fn();
vi.mock("./tools/registry", () => ({ runTool: (...a: unknown[]) => runToolMock(...a) }));

import { processCallEvent, type VoiceAction } from "./call-events";
import { emptyCallState } from "./call-state";
import { handoffLine } from "./handoff";
import type { ToolContext } from "./tools/registry";

// Still NOT a real tool context — `runTool` is mocked, so nothing here reaches
// a database. The one field is the profile's LANGUAGE, which `processCallEvent`
// itself reads to pin the handoff sentence (see the transfer tests below);
// everything else stays absent on purpose.
const ctx = { profile: { languages: "en" } } as unknown as ToolContext;

/** `VoiceAction` is a union now (a `close` variant carries no payload), so
 *  reading `.payload` has to narrow first rather than assume. */
function toolOutputOf(action: VoiceAction): string {
  if (action.kind !== "send") throw new Error(`expected a send action, got ${action.kind}`);
  return (action.payload as unknown as { item: { output: string } }).item.output;
}

describe("processCallEvent", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("assistant transcript event appends and produces no actions", async () => {
    const { state, actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.output_audio_transcript.done", transcript: "How can I help?" });
    expect(state.transcript[0]).toMatchObject({ role: "assistant", text: "How can I help?" });
    expect(actions).toEqual([]);
  });
  it("caller transcript event appends as caller", async () => {
    const { state } = await processCallEvent(emptyCallState(), ctx,
      { type: "conversation.item.input_audio_transcription.completed", transcript: "hola" });
    expect(state.transcript[0]).toMatchObject({ role: "caller", text: "hola" });
  });
  // ── A recording is not a caller ──────────────────────────────────────
  it("a recorded broadcast is marked and hung up on, not conversed with", async () => {
    // Verbatim shape from the eight robocalls that reached 956 Woodworks on
    // 2026-09-17. Sofía answered every one of them helpfully for another
    // forty seconds, on the client's bill.
    const { state, actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "conversation.item.input_audio_transcription.completed",
        transcript: "Hello, please don't hang up the phone. This is an important message "
    + "regarding your Google business account. Press 0 to speak with an agent "
    + "immediately and verify your Google listings. Press 9 to opt out." });
    expect(state.recordedCaller).toBe(true);
    expect(actions).toEqual([{ kind: "hangup" }]);
  });

  it("keeps the recording's transcript — it is the only evidence the guard was right", async () => {
    // Dropping the turn would make a false positive unauditable: the call row
    // would say spam with nothing in it explaining why, which is
    // indistinguishable from a silent call.
    const { state } = await processCallEvent(emptyCallState(), ctx,
      { type: "conversation.item.input_audio_transcription.completed",
        transcript: "Hello, please don't hang up the phone. This is an important message "
    + "regarding your Google business account. Press 0 to speak with an agent "
    + "immediately and verify your Google listings. Press 9 to opt out." });
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({ role: "caller" });
  });

  it("an ordinary caller is neither marked nor hung up on", async () => {
    // The negative that costs the most to get wrong, at this layer too: a
    // hangup here leaves a real lead with no trace they ever rang.
    const { state, actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "conversation.item.input_audio_transcription.completed",
        transcript: "Hi, I found you on Google and wanted to ask about a dining table." });
    expect(state.recordedCaller).toBe(false);
    expect(actions).toEqual([]);
  });

  it("empty transcript is ignored", async () => {
    const { state } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.output_audio_transcript.done", transcript: "" });
    expect(state.transcript).toHaveLength(0);
  });
  it("function call dispatches runTool and replies with output + response.create", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true, x: 1 } });
    const { actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "take_message", call_id: "fc1", arguments: '{"body":"hi"}' });
    expect(runToolMock).toHaveBeenCalledWith(expect.anything(), ctx, "take_message", { body: "hi" });
    expect(actions).toEqual([
      { kind: "send", payload: { type: "conversation.item.create",
        item: { type: "function_call_output", call_id: "fc1", output: JSON.stringify({ ok: true, x: 1 }) } } },
      { kind: "send", payload: { type: "response.create" } },
    ]);
  });
  it("an unknown tool name keeps its 'unknown tool' label and logs", async () => {
    runToolMock.mockRejectedValue(new Error("Unknown tool: nope"));
    const { actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "nope", call_id: "fc2", arguments: "{}" });
    expect(toolOutputOf(actions[0]!))
      .toBe(JSON.stringify({ ok: false, error: "unknown tool" }));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
  it("a genuine tool failure (e.g. a DB outage mid-booking) is logged and NOT mislabeled as 'unknown tool'", async () => {
    runToolMock.mockRejectedValue(new Error("db down"));
    const { actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "book_appointment", call_id: "fc3", arguments: "{}" });
    const output = JSON.parse(toolOutputOf(actions[0]!));
    expect(output).toEqual({ ok: false, error: "tool failed — apologize and offer to take a message" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("voice tool book_appointment failed: Error: db down"));
  });
  it("bad JSON args become {}", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "take_message", call_id: "fc3", arguments: "{{{" });
    expect(runToolMock).toHaveBeenCalledWith(expect.anything(), ctx, "take_message", {});
  });
  // The close action: the ONLY thing that ends the AI leg so the carrier can
  // dial a human. Derived here from what this module itself sees — the tool
  // NAME and the RESULT — because nothing else in the process knows both.
  it("a successful transfer_to_human yields a close action after the spoken line", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    const { actions } = await processCallEvent(emptyCallState(), ctx, {
      type: "response.function_call_arguments.done", name: "transfer_to_human", arguments: "{}", call_id: "c1",
    });
    expect(actions.map((a) => a.kind)).toEqual(["send", "send", "close"]);
  });
  it("the transfer's response.create carries the pinned handoff sentence, in the profile's language", async () => {
    // The one line of the call that must not be improvised: the socket dies a
    // few seconds later, so whatever the model says here is the last thing the
    // caller hears from Sofía. A bare `response.create` (what every other tool
    // gets) leaves it to the model.
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    const es = { ...ctx, profile: { languages: "es" } } as unknown as ToolContext;
    const { actions } = await processCallEvent(emptyCallState(), es, {
      type: "response.function_call_arguments.done", name: "transfer_to_human", arguments: "{}", call_id: "c1",
    });
    const second = actions[1]!;
    if (second.kind !== "send") throw new Error("expected a send");
    expect(second.payload).toEqual({ type: "response.create", response: { instructions: handoffLine("es") } });
    expect(handoffLine("es")).not.toBe(handoffLine("en"));
  });
  it("every other tool still gets a bare response.create", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    const { actions } = await processCallEvent(emptyCallState(), ctx, {
      type: "response.function_call_arguments.done", name: "take_message",
      arguments: JSON.stringify({ body: "call me" }), call_id: "c1",
    });
    const second = actions[1]!;
    if (second.kind !== "send") throw new Error("expected a send");
    expect(second.payload).toEqual({ type: "response.create" });
  });
  it("a REFUSED transfer yields no close action — the call continues with Sofía", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: false, error: "no target" } });
    const { actions } = await processCallEvent(emptyCallState(), ctx, {
      type: "response.function_call_arguments.done", name: "transfer_to_human", arguments: "{}", call_id: "c1",
    });
    expect(actions.map((a) => a.kind)).toEqual(["send", "send"]);
  });
  it("no other tool ever yields a close action", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    const { actions } = await processCallEvent(emptyCallState(), ctx, {
      type: "response.function_call_arguments.done", name: "take_message",
      arguments: JSON.stringify({ body: "call me" }), call_id: "c1",
    });
    expect(actions.some((a) => a.kind === "close")).toBe(false);
  });
  it("a transfer_to_human that THREW is not a transfer — no close action", async () => {
    // The catch branch answers the model with its own {ok:false} payload; it
    // must not also be read as a successful handoff and hang up on the caller.
    runToolMock.mockRejectedValue(new Error("db down"));
    const { actions } = await processCallEvent(emptyCallState(), ctx, {
      type: "response.function_call_arguments.done", name: "transfer_to_human", arguments: "{}", call_id: "c1",
    });
    expect(actions.map((a) => a.kind)).toEqual(["send", "send"]);
  });
  it("unknown event types are a no-op", async () => {
    const { state, actions } = await processCallEvent(emptyCallState(), ctx, { type: "session.updated" });
    expect(actions).toEqual([]);
    expect(state.transcript).toHaveLength(0);
  });

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
});
