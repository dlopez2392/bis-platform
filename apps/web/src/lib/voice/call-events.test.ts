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
});
