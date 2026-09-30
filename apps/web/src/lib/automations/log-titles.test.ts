import { describe, it, expect } from "vitest";
import { AUTOMATION_LOG_SOURCES } from "@bis/db";
import { SOURCE_TITLES, CHANNEL_WORDS, STATUS_TREATMENTS } from "./log-titles";

describe("log titles", () => {
  it("every source the database allows has a title, and no title is the key itself (mutation: delete one entry → typecheck AND this FAIL)", () => {
    for (const source of AUTOMATION_LOG_SOURCES) {
      expect(SOURCE_TITLES[source], source).toMatch(/^[A-Z][a-z]/);
      expect(SOURCE_TITLES[source], source).not.toBe(source);
      expect(SOURCE_TITLES[source], source).not.toContain("_");
    }
  });
  it("the recipe titles ARE the catalogue's own titles (mutation: retype one → FAILS)", () => {
    expect(SOURCE_TITLES.review_request).toBe("Review requests");
    expect(SOURCE_TITLES.sms_reminder).toBe("Text reminders");
    expect(SOURCE_TITLES.no_show_nudge).toBe("No-show follow-ups");
    expect(SOURCE_TITLES.instant_reply).toBe("Instant reply to new leads");
  });
  it("four distinct status words and three channel words", () => {
    expect(new Set(Object.values(STATUS_TREATMENTS).map((t) => t.label)).size).toBe(4);
    expect(Object.keys(CHANNEL_WORDS).sort()).toEqual(["ai", "email", "sms"]);
    for (const t of Object.values(STATUS_TREATMENTS)) { expect(t.dot).toMatch(/^bg-/); expect(t.chip).toContain("border-"); }
  });
});
