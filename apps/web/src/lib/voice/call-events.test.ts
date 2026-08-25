import { describe, it, expect, vi } from "vitest";

const runToolMock = vi.fn();
vi.mock("./tools/registry", () => ({ runTool: (...a: unknown[]) => runToolMock(...a) }));

import { processCallEvent } from "./call-events";
import { emptyCallState } from "./call-state";
import type { ToolContext } from "./tools/registry";

const ctx = {} as unknown as ToolContext;

describe("processCallEvent", () => {
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
  it("a throwing tool still answers the model instead of crashing the call", async () => {
    runToolMock.mockRejectedValue(new Error("Unknown tool: nope"));
    const { actions } = await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "nope", call_id: "fc2", arguments: "{}" });
    expect((actions[0]!.payload as unknown as { item: { output: string } }).item.output)
      .toBe(JSON.stringify({ ok: false, error: "unknown tool" }));
  });
  it("bad JSON args become {}", async () => {
    runToolMock.mockResolvedValue({ state: emptyCallState(), result: { ok: true } });
    await processCallEvent(emptyCallState(), ctx,
      { type: "response.function_call_arguments.done", name: "take_message", call_id: "fc3", arguments: "{{{" });
    expect(runToolMock).toHaveBeenCalledWith(expect.anything(), ctx, "take_message", {});
  });
  it("unknown event types are a no-op", async () => {
    const { state, actions } = await processCallEvent(emptyCallState(), ctx, { type: "session.updated" });
    expect(actions).toEqual([]);
    expect(state.transcript).toHaveLength(0);
  });
});
