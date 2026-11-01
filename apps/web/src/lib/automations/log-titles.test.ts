import { describe, it, expect } from "vitest";
import { AUTOMATION_LOG_SOURCES } from "@bis/db";
import { m } from "@/lib/messages";
import { SOURCE_TITLES, CHANNEL_WORDS, STATUS_TREATMENTS, sourceTitle, channelWord, statusWord } from "./log-titles";

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

  // S-10 T5: SOURCE_TITLES/CHANNEL_WORDS/STATUS_TREATMENTS are English, built once at load; the
  // real screen (activity-table.tsx, log-status-pill.tsx) used to read them directly.
  describe("sourceTitle/channelWord/statusWord (S-10 T5)", () => {
    it("translate every reminders/followups/weekly_report/concierge/voice/textback source (mutation: hard-code English -> FAILS)", () => {
      expect(sourceTitle("reminders", "es")).toBe(m["activity.source.reminders.es"]);
      expect(sourceTitle("followups", "es")).toBe(m["activity.source.followups.es"]);
      expect(sourceTitle("weekly_report", "es")).toBe(m["activity.source.weekly_report.es"]);
      expect(sourceTitle("concierge", "es")).toBe(m["activity.source.concierge.es"]);
      expect(sourceTitle("voice", "es")).toBe(m["activity.source.voice.es"]);
      expect(sourceTitle("textback", "es")).toBe(m["activity.source.textback.es"]);
      expect(sourceTitle("reminders", "en")).toBe(SOURCE_TITLES.reminders);
    });

    it("translates every channel and status word", () => {
      expect(channelWord("sms", "es")).toBe(m["activity.channel.sms.es"]);
      expect(channelWord("email", "es")).toBe(m["activity.channel.email.es"]);
      expect(channelWord("ai", "es")).toBe(m["activity.channel.ai.es"]);
      expect(statusWord("sent", "es")).toBe(m["activity.status.sent.es"]);
      expect(statusWord("held", "es")).toBe(m["activity.status.held.es"]);
      expect(statusWord("skipped", "es")).toBe(m["activity.status.skipped.es"]);
      expect(statusWord("failed", "es")).toBe(m["activity.status.failed.es"]);
    });
  });
});
