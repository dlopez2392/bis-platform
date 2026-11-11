// apps/web/src/lib/owner-line/session-config.test.ts
// F-032 plan Task 12: the owner-line session's accept body (spec §4.4) and "the wall" (spec §7): an owner-line
// session holds ONLY the owner tools, and no receptionist session, in any variant, holds one of them.
import { describe, it, expect } from "vitest";
import { buildOwnerLineSessionConfig, OWNER_LINE_MAX_CALL_SECONDS } from "./session-config";
import { ownerLineGreeting, ownerLineWarning } from "./prompt";
import { OWNER_TOOL_NAMES } from "./tools/schemas";
import { toolSchemas } from "@/lib/voice/tools/schemas";

const P = { firstName: "Dan", locale: "en" as const, businessName: "Rio Roofing", personaName: "Sofía", timezone: "America/Chicago", now: new Date("2026-11-09T21:00:00Z") };
describe("the owner-line session (spec §4.4)", () => {
  it("is FLAT (type/model/instructions/tools/audio at the top level), never nested under session", () => {
    expect(Object.keys(buildOwnerLineSessionConfig(P)).sort()).toEqual(["audio", "instructions", "model", "tools", "type"]);
  });
  it("registers ONLY the owner tools: no booking, no lead capture, no transfer (mutation: concat toolSchemas(...) -> FAILS)", () => {
    const names = buildOwnerLineSessionConfig(P).tools.map((t) => t.name);
    expect(names).toEqual(["calls_and_messages", "appointments", "needs_attention"]);
    const receptionist = toolSchemas("full", "in_person", true).map((t: { name: string }) => t.name);
    expect(names.some((n) => (receptionist as string[]).includes(n))).toBe(false);
  });
  it("no receptionist session, in ANY variant, registers an owner tool, whatever the caller says (spec §7 'the wall')", () => {
    for (const mode of ["full", "manage", "none"] as const) {
      for (const meeting of ["in_person", "phone", "video"] as const) {
        for (const handoff of [true, false]) {
          const names = toolSchemas(mode, meeting, handoff).map((t: { name: string }) => t.name);
          expect(names.filter((n) => (OWNER_TOOL_NAMES as readonly string[]).includes(n))).toEqual([]);
        }
      }
    }
  });
  it("speaks to the person by first name, in their language, and is not the receptionist's prompt", () => {
    const i = buildOwnerLineSessionConfig({ ...P, locale: "es" }).instructions;
    expect(i).toContain("Dan");
    expect(i).toContain("Spanish");
    expect(i).toContain("usted");
    // Not the receptionist's prompt: none of its tool names or its message-taking rule.
    expect(i).not.toMatch(/take_message|capture_lead|book_appointment|transfer_to_human|take a message/i);
  });
  it("tells the model the line is read-only, that every number and name comes from a tool, and what to say on couldnt_read", () => {
    const i = buildOwnerLineSessionConfig(P).instructions;
    expect(i).toContain("I couldn't read that just now.");
    expect(i).toContain("No pude leer eso en este momento.");
    expect(i).toMatch(/cannot book, cancel, move, text, call anyone, or change anything/);
    expect(i).toMatch(/Every number and every name you say must come from a tool result/);
    expect(i).toMatch(/couldnt_read/);
  });
  it("uses the receptionist's model, voice, transcription and turn detection, so a real call sounds the same", () => {
    const c = buildOwnerLineSessionConfig(P);
    expect(c.type).toBe("realtime");
    expect(c.audio).toMatchObject({ input: { transcription: { model: "gpt-4o-mini-transcribe" } }, output: { voice: "marin" } });
  });
  it("ends at 10 minutes, with a one-minute warning said in the person's language", () => {
    expect(OWNER_LINE_MAX_CALL_SECONDS).toBe(600);
    expect(ownerLineWarning("en")).toContain("We have one minute left on this call.");
    expect(ownerLineWarning("es")).toContain("Nos queda un minuto en esta llamada.");
  });
  it("the greeting names the person when there is a name, in their language", () => {
    expect(ownerLineGreeting({ firstName: "Dan", locale: "es" })).toMatch(/Spanish.*Dan/);
    expect(ownerLineGreeting({ firstName: null, locale: "en" })).not.toMatch(/null/);
  });
});
