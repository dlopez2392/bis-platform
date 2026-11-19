// apps/web/src/lib/tools/customer/shapes.test.ts
// F-023 PR 2: every customer tool a session is sent, byte for byte. The fixture was captured from belt/core (fdbc7ef2,
// main's phone tools unchanged) BEFORE the tools moved onto the belt: one JSON.stringify per tool, in session order,
// for every booking mode × meeting type × handoff, plus the web chat's capture_lead. A change of a character, a key's
// order or an array's order in what a phone call or a chat turn sends fails here.
import { describe, it, expect } from "vitest";
import { toolSchemas } from "@/lib/voice/tools/schemas";
import type { BookingMode } from "@/lib/voice/booking-mode";
import { CAPTURE_LEAD_TOOL } from "@/lib/concierge/prompt";
import fixture from "./customer-tool-schemas.fixture.json";

const MODES = ["full", "manage", "none"] as const satisfies readonly BookingMode[];
const MEETING_TYPES = ["in_person", "phone", "video"] as const;
const HANDOFF = [true, false] as const;

// A TYPE check: a fourth booking mode makes this line an error until MODES (and the fixture) carry it.
const everyMode: Record<BookingMode, true> = { full: true, manage: true, none: true };

describe("the customer tools' transport shapes (F-023: byte-identical across the move to the belt)", () => {
  it("covers every booking mode × meeting type × handoff, and nothing else", () => {
    expect(Object.keys(everyMode)).toEqual([...MODES]);
    const keys = MODES.flatMap((m) => MEETING_TYPES.flatMap((t) => HANDOFF.map((h) => `${m}|${t}|${h}`)));
    expect(Object.keys(fixture.phone)).toEqual(keys);
  });

  for (const mode of MODES) {
    for (const meetingType of MEETING_TYPES) {
      for (const handoff of HANDOFF) {
        const key = `${mode}|${meetingType}|${handoff}` as keyof typeof fixture.phone;
        it(`toolSchemas(${mode}, ${meetingType}, ${handoff}) serialises exactly as captured, tool by tool, key order included`, () => {
          const tools = toolSchemas(mode, meetingType, handoff);
          expect(tools.map((t) => JSON.stringify(t))).toEqual(fixture.phone[key]);
          expect(JSON.stringify(tools)).toBe(`[${fixture.phone[key].join(",")}]`);
        });
      }
    }
  }

  it("the web chat's CAPTURE_LEAD_TOOL serialises exactly as captured", () => {
    expect(JSON.stringify(CAPTURE_LEAD_TOOL)).toBe(fixture.chatCaptureLead);
  });
});
