// apps/web/src/lib/owner-line/events.test.ts
// F-032 plan Task 12: the owner line's frame handler. Its only tools are the owner tools, through runOwnerTool.
import { describe, it, expect, vi } from "vitest";
import { processOwnerLineEvent } from "./events";
import { emptyCallState } from "@/lib/voice/call-state";

type Ran = Set<"calls_and_messages" | "appointments" | "needs_attention">;
const ctx = (recheck = vi.fn(async () => false)) => ({ session: {} as never, now: () => new Date(), recheck, client: vi.fn() });

describe("processOwnerLineEvent", () => {
  it("a tool call runs ONLY through runOwnerTool's context and records which tool ran", async () => {
    const recheck = vi.fn(async () => false);
    const ran: Ran = new Set();
    const r = await processOwnerLineEvent(emptyCallState(), ctx(recheck), ran,
      { type: "response.function_call_arguments.done", name: "appointments", call_id: "fc1", arguments: "{\"range\":\"today\"}" });
    expect(recheck).toHaveBeenCalledOnce();
    expect(r.actions[0]).toEqual({ kind: "send", payload: { type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "fc1", output: JSON.stringify({ ok: false, error: "couldnt_read" }) } } });
    expect(r.actions[1]).toEqual({ kind: "send", payload: { type: "response.create" } });
    expect([...ran]).toEqual(["appointments"]);
  });
  it("a receptionist tool name asked for on this line is refused and never recorded (spec §7 'the wall')", async () => {
    const ran: Ran = new Set();
    const recheck = vi.fn(async () => true);
    const r = await processOwnerLineEvent(emptyCallState(), ctx(recheck), ran,
      { type: "response.function_call_arguments.done", name: "book_appointment", call_id: "x", arguments: "{}" });
    expect([...ran]).toEqual([]);
    expect(recheck).not.toHaveBeenCalled();
    expect(r.actions[0]).toEqual({ kind: "send", payload: { type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "x", output: JSON.stringify({ ok: false, error: "unknown_tool" }) } } });
  });
  it("never ends the call: no close and no hangup action, whatever arrives", async () => {
    for (const event of [
      { type: "response.function_call_arguments.done", name: "transfer_to_human", call_id: "t", arguments: "{}" },
      { type: "conversation.item.input_audio_transcription.completed", transcript: "press 1 to speak to an agent now press 0", item_id: "i9" },
    ]) {
      const r = await processOwnerLineEvent(emptyCallState(), ctx(), new Set(), event);
      expect(r.actions.every((a) => a.kind === "send")).toBe(true);
    }
  });
  it("records both sides of the conversation into the transcript", async () => {
    let s = emptyCallState();
    const c = ctx();
    s = (await processOwnerLineEvent(s, c, new Set(), { type: "conversation.item.input_audio_transcription.completed", transcript: "hi", item_id: "i1" })).state;
    s = (await processOwnerLineEvent(s, c, new Set(), { type: "response.output_audio_transcript.done", transcript: "Hi Dan" })).state;
    expect(s.transcript.map((t) => [t.role, t.text])).toEqual([["caller", "hi"], ["assistant", "Hi Dan"]]);
  });
  it("a re-delivered caller turn is recorded once, as the receptionist's handler does (callerItemIds)", async () => {
    let s = emptyCallState();
    const c = ctx();
    const turn = { type: "conversation.item.input_audio_transcription.completed", transcript: "what's on today?", item_id: "i1" };
    s = (await processOwnerLineEvent(s, c, new Set(), turn)).state;
    s = (await processOwnerLineEvent(s, c, new Set(), turn)).state;
    expect(s.transcript.filter((t) => t.role === "caller")).toHaveLength(1);
  });
});
