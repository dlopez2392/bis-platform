import { describe, it, expect } from "vitest";
import { AUTOMATION_LOG_SOURCES } from "@bis/db";
import { m } from "@/lib/messages";
import { STATUS_TREATMENTS, sourceTitle, channelWord, statusWord } from "./log-titles";

// S-10 T9b: SOURCE_TITLES and CHANNEL_WORDS (English-only module constants)
// were deleted — T5 built sourceTitle()/channelWord() beside them but had no
// file consent to touch every remaining reader; this lane found none left
// (activity-table.tsx and log-status-pill.tsx already use the locale-aware
// functions), so the dead English-only constants are gone and
// STATUS_TREATMENTS keeps only dot/chip (no m[...] read at all — the label
// is statusWord(status, locale) now, for the one remaining reader that used
// to spread `.label` off it).
describe("log titles", () => {
  it("every source the database allows has an English title via sourceTitle, and no title is the key itself (mutation: delete one entry → typecheck AND this FAIL)", () => {
    for (const source of AUTOMATION_LOG_SOURCES) {
      const title = sourceTitle(source, "en");
      expect(title, source).toMatch(/^[A-Z][a-z]/);
      expect(title, source).not.toBe(source);
      expect(title, source).not.toContain("_");
    }
  });
  it("the recipe titles ARE the catalogue's own titles (mutation: retype one → FAILS)", () => {
    expect(sourceTitle("review_request", "en")).toBe("Review requests");
    expect(sourceTitle("sms_reminder", "en")).toBe("Text reminders");
    expect(sourceTitle("no_show_nudge", "en")).toBe("No-show follow-ups");
    expect(sourceTitle("instant_reply", "en")).toBe("Instant reply to new leads");
  });
  it("four distinct status words (en) and STATUS_TREATMENTS carries only dot/chip, no label (mutation: put label back on STATUS_TREATMENTS → FAILS, this file's own typecheck)", () => {
    expect(new Set((["sent", "held", "skipped", "failed"] as const).map((s) => statusWord(s, "en"))).size).toBe(4);
    for (const t of Object.values(STATUS_TREATMENTS)) {
      expect(t.dot).toMatch(/^bg-/); expect(t.chip).toContain("border-");
      expect(t as object).not.toHaveProperty("label");
    }
  });

  // S-10 T5/T9b: sourceTitle/channelWord/statusWord are the ONLY way to read
  // these words now; the real screens (activity-table.tsx,
  // log-status-pill.tsx) use them.
  describe("sourceTitle/channelWord/statusWord", () => {
    it("translate every reminders/followups/weekly_report/concierge/voice/textback source (mutation: hard-code English -> FAILS)", () => {
      expect(sourceTitle("reminders", "es")).toBe(m["activity.source.reminders.es"]);
      expect(sourceTitle("followups", "es")).toBe(m["activity.source.followups.es"]);
      expect(sourceTitle("weekly_report", "es")).toBe(m["activity.source.weekly_report.es"]);
      expect(sourceTitle("concierge", "es")).toBe(m["activity.source.concierge.es"]);
      expect(sourceTitle("voice", "es")).toBe(m["activity.source.voice.es"]);
      expect(sourceTitle("textback", "es")).toBe(m["activity.source.textback.es"]);
      expect(sourceTitle("reminders", "en")).toBe(m["activity.source.reminders"]);
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
