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
    const book = tool(toolSchemas(true, "video"), "book_appointment");
    expect(book.description).toMatch(/VIDEO/);
    expect(book.description).toMatch(/emailDeclined is NOT accepted/);
    expect(book.description).toMatch(/take_message/);
    expect(book.description).not.toMatch(/or emailDeclined: true if they said no/);
    expect(book.parameters.properties.emailDeclined!.description).toMatch(/Not accepted/);
    expect(book.parameters.properties.emailDeclined!.description).toMatch(/take_message/);
  });

  it("non-video calendars keep the original decline-is-allowed contract", () => {
    for (const mt of ["in_person", "phone"] as const) {
      const book = tool(toolSchemas(true, mt), "book_appointment");
      expect(book.description).toMatch(/or emailDeclined: true if they said no/);
      expect(book.description).not.toMatch(/emailDeclined is NOT accepted/);
    }
  });

  it("the video variant touches ONLY book_appointment — every other tool is identical", () => {
    const video = toolSchemas(true, "video");
    const plain = toolSchemas(true, "in_person");
    expect(video.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i++) {
      if ((plain[i] as Tool).name === "book_appointment") continue;
      expect(video[i]).toEqual(plain[i]);
    }
  });

  it("bookingEnabled=false strips booking tools regardless of meeting type", () => {
    const names = (toolSchemas(false, "video") as Tool[]).map((t) => t.name);
    expect(names).not.toContain("book_appointment");
    expect(names).toContain("take_message");
  });
});
