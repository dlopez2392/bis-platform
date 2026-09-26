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
    const book = tool(toolSchemas(true, "video", false), "book_appointment");
    expect(book.description).toMatch(/VIDEO/);
    expect(book.description).toMatch(/emailDeclined is NOT accepted/);
    expect(book.description).toMatch(/take_message/);
    expect(book.description).not.toMatch(/or emailDeclined: true if they said no/);
    expect(book.parameters.properties.emailDeclined!.description).toMatch(/Not accepted/);
    expect(book.parameters.properties.emailDeclined!.description).toMatch(/take_message/);
  });

  it("non-video calendars keep the original decline-is-allowed contract", () => {
    for (const mt of ["in_person", "phone"] as const) {
      const book = tool(toolSchemas(true, mt, false), "book_appointment");
      expect(book.description).toMatch(/or emailDeclined: true if they said no/);
      expect(book.description).not.toMatch(/emailDeclined is NOT accepted/);
    }
  });

  it("the video variant touches ONLY book_appointment — every other tool is identical", () => {
    const video = toolSchemas(true, "video", false);
    const plain = toolSchemas(true, "in_person", false);
    expect(video.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      if ((plain[i] as Tool).name === "book_appointment") continue;
      expect(video[i]).toEqual(plain[i]);
    }
  });

  it("bookingEnabled=false strips booking tools regardless of meeting type", () => {
    const names = (toolSchemas(false, "video", false) as Tool[]).map((t) => t.name);
    expect(names).not.toContain("book_appointment");
    expect(names).toContain("take_message");
  });

  // The model offers what it is given. Advertising a transfer the business
  // never configured gets a caller told "let me put you through" and then
  // apologised to — the gate belongs here, not only in the tool's refusal.
  it("transfer_to_human is advertised ONLY when the call has a target", () => {
    const withTarget = (toolSchemas(true, "in_person", true) as Tool[]).map((t) => t.name);
    const without = (toolSchemas(true, "in_person", false) as Tool[]).map((t) => t.name);
    expect(withTarget).toContain("transfer_to_human");
    expect(without).not.toContain("transfer_to_human");
  });

  it("asking for a person has nothing to do with booking — the tool survives bookingEnabled=false", () => {
    const names = (toolSchemas(false, "video", true) as Tool[]).map((t) => t.name);
    expect(names).toContain("transfer_to_human");
    expect(names).not.toContain("book_appointment");
  });

  // Booking tools are bound to the verified caller. A declared `phone`
  // parameter is an invitation to pass whatever number the caller recites;
  // the tool takes none, and says it only looks up the number they are
  // calling from.
  it("find_my_booking takes no phone — no parameters at all — and says it only looks up the calling number", () => {
    for (const mt of ["in_person", "phone", "video"] as const) {
      const find = tool(toolSchemas(true, mt, false), "find_my_booking");
      expect(find.parameters.properties).not.toHaveProperty("phone");
      expect(find.parameters.properties).toEqual({});
      expect(find.description).toMatch(/calling from/);
      expect(find.description).toMatch(/cannot look up any other number/);
    }
  });

  it("reschedule and cancel are only for a booking found or booked on this call", () => {
    for (const name of ["reschedule_appointment", "cancel_appointment"]) {
      const t = tool(toolSchemas(true, "in_person", false), name);
      expect(t.description).toMatch(/find_my_booking returned on this call/);
      expect(t.description).toMatch(/booked on this call/);
    }
  });

  it("check_availability's contract explains the slot shape: ISO for tools, local for speech", () => {
    const check = tool(toolSchemas(true, "in_person", false), "check_availability");
    expect(check.description).toMatch(/startsAt/);
    expect(check.description).toMatch(/local/);
    expect(check.description).toMatch(/say/i);
  });
});
