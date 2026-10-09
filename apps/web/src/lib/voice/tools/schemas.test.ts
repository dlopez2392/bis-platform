// 2026-08-30 live call: on a video calendar the caller declined email and
// Sofía invented a phone-only booking path. The system prompt already said
// email-is-required (prompt rules are wishes); the tool CONTRACT still told
// her `emailDeclined: true` was a valid way to book — the one place the rule
// is enforcement-adjacent said the opposite of the video gate. These tests
// pin the meeting-type-aware contract.
import { describe, it, expect } from "vitest";
import { toolSchemas } from "./schemas";

type Tool = { name: string; description: string; parameters: { properties: Record<string, { description?: string }> } };

function tool(list: readonly unknown[], name: string): Tool {
  const hit = (list as Tool[]).find((t) => t.name === name);
  if (!hit) throw new Error(`tool ${name} missing`);
  return hit;
}

describe("toolSchemas", () => {
  it("video calendars rewrite book_appointment's contract: email required, emailDeclined not accepted, take_message named", () => {
    const book = tool(toolSchemas("full", "video", false), "book_appointment");
    expect(book.description).toMatch(/VIDEO/);
    expect(book.description).toMatch(/emailDeclined is NOT accepted/);
    expect(book.description).toMatch(/take_message/);
    expect(book.description).not.toMatch(/or emailDeclined: true if they said no/);
    expect(book.parameters.properties.emailDeclined!.description).toMatch(/Not accepted/);
    expect(book.parameters.properties.emailDeclined!.description).toMatch(/take_message/);
  });

  it("non-video calendars keep the original decline-is-allowed contract", () => {
    for (const mt of ["in_person", "phone"] as const) {
      const book = tool(toolSchemas("full", mt, false), "book_appointment");
      expect(book.description).toMatch(/or emailDeclined: true if they said no/);
      expect(book.description).not.toMatch(/emailDeclined is NOT accepted/);
    }
  });

  it("the video variant touches ONLY book_appointment — every other tool is identical", () => {
    const video = toolSchemas("full", "video", false);
    const plain = toolSchemas("full", "in_person", false);
    expect(video.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      if ((plain[i] as Tool).name === "book_appointment") continue;
      expect(video[i]).toEqual(plain[i]);
    }
  });

  it("bookingEnabled=false strips booking tools regardless of meeting type", () => {
    const names = (toolSchemas("none", "video", false) as Tool[]).map((t) => t.name);
    expect(names).not.toContain("book_appointment");
    expect(names).toContain("take_message");
  });

  // The model offers what it is given. Advertising a transfer the business
  // never configured gets a caller told "let me put you through" and then
  // apologised to — the gate belongs here, not only in the tool's refusal.
  it("transfer_to_human is advertised ONLY when the call has a target", () => {
    const withTarget = (toolSchemas("full", "in_person", true) as Tool[]).map((t) => t.name);
    const without = (toolSchemas("full", "in_person", false) as Tool[]).map((t) => t.name);
    expect(withTarget).toContain("transfer_to_human");
    expect(without).not.toContain("transfer_to_human");
  });

  it("asking for a person has nothing to do with booking — the tool survives bookingEnabled=false", () => {
    const names = (toolSchemas("none", "video", true) as Tool[]).map((t) => t.name);
    expect(names).toContain("transfer_to_human");
    expect(names).not.toContain("book_appointment");
  });

  // Booking tools are bound to the caller ID. A declared `phone`
  // parameter is an invitation to pass whatever number the caller recites;
  // the tool takes none, and says it only looks up the number they are
  // calling from.
  it("find_my_booking takes no phone — no parameters at all — and says it only looks up the calling number", () => {
    for (const mt of ["in_person", "phone", "video"] as const) {
      const find = tool(toolSchemas("full", mt, false), "find_my_booking");
      expect(find.parameters.properties).not.toHaveProperty("phone");
      expect(find.parameters.properties).toEqual({});
      expect(find.description).toMatch(/calling from/);
      expect(find.description).toMatch(/cannot look up any other number/);
    }
  });

  it("reschedule and cancel are only for a booking found or booked on this call", () => {
    for (const name of ["reschedule_appointment", "cancel_appointment"]) {
      const t = tool(toolSchemas("full", "in_person", false), name);
      expect(t.description).toMatch(/find_my_booking returned on this call/);
      expect(t.description).toMatch(/booked on this call/);
    }
  });

  it("check_availability's contract explains the slot shape: ISO for tools, local for speech", () => {
    const check = tool(toolSchemas("full", "in_person", false), "check_availability");
    expect(check.description).toMatch(/startsAt/);
    expect(check.description).toMatch(/local/);
    expect(check.description).toMatch(/say/i);
  });
});

describe("phone parameters say how to write a number (review R1-I4)", () => {
  it("book_appointment.phone and take_message.callbackNumber ask for the digits as spoken, with no country code the caller did not say (mutation: drop either description → FAILS)", () => {
    for (const mt of ["in_person", "phone", "video"] as const) {
      const tools = toolSchemas("full", mt, false) as unknown as Tool[];
      const book = tools.find((t) => t.name === "book_appointment")!;
      expect(book.parameters.properties.phone!.description).toBe("Digits as spoken; no country code unless the caller said one.");
      const msg = tools.find((t) => t.name === "take_message")!;
      expect(msg.parameters.properties.callbackNumber!.description).toBe("Digits as spoken; no country code unless the caller said one.");
      expect(tools.find((t) => t.name === "capture_lead")!.description).toMatch(/no country code unless the caller said one/);
    }
  });
});

// Owner decision A (2026-10-09): "Always take a message" withholds only the
// tool that books a NEW appointment; the contract of what stays never names it.
describe("toolSchemas — manage mode (Always take a message)", () => {
  type T = { name: string; description: string };
  it("offers find/move/cancel and the availability a move needs, never book_appointment", () => {
    const tools = toolSchemas("manage", "in_person", false) as unknown as T[];
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("book_appointment");
    for (const n of ["check_availability", "find_my_booking", "reschedule_appointment", "cancel_appointment", "take_message"]) {
      expect(names).toContain(n);
    }
    expect(JSON.stringify(tools)).not.toContain("book_appointment");
  });
});
