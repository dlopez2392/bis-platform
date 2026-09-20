import { describe, it, expect } from "vitest";
import {
  parseCaptureLead, splitName, budgetNotice, CAPTURE_LEAD_TOOL,
  CONCIERGE_BUDGET_WARN_TURNS, WEB_TOOL_NOTICE,
} from "./prompt";

describe("parseCaptureLead", () => {
  it("returns null on malformed JSON rather than throwing", () => {
    expect(parseCaptureLead("{not json")).toBeNull();
  });

  it("returns null without a name — a lead nobody can be called back is not one", () => {
    expect(parseCaptureLead(JSON.stringify({ email: "a@b.co" }))).toBeNull();
  });

  it("coerces non-strings to empty rather than into the CRM", () => {
    const out = parseCaptureLead(JSON.stringify({ fullName: "Ana", email: 42, need: null }));
    // MUTATION: return parsed.email directly — this FAILS, and a number
    // reaches enrich() as an email address.
    expect(out).toEqual({ fullName: "Ana", email: "", phone: "", need: "" });
  });

  it("offers exactly one tool, and it is not booking", () => {
    expect(CAPTURE_LEAD_TOOL.function.name).toBe("capture_lead");
    expect(JSON.stringify(CAPTURE_LEAD_TOOL)).not.toContain("book");
  });
});

describe("splitName", () => {
  it("splits on the first space, so a surname reaches the surname column", () => {
    expect(splitName("Ana García")).toEqual({ first: "Ana", last: "García" });
  });

  it("keeps a multi-word surname whole", () => {
    expect(splitName("Ana María García Peña"))
      .toEqual({ first: "Ana", last: "María García Peña" });
  });

  it("leaves last blank for a single name rather than inventing one", () => {
    expect(splitName("Ana")).toEqual({ first: "Ana", last: "" });
  });
});

describe("WEB_TOOL_NOTICE", () => {
  /**
   * `buildSystemPrompt`'s TOOLS block advertises take_message and
   * log_transcript on every medium — they are the phone path's floor. Neither
   * exists here, and the route hands the model exactly one tool. A model told
   * it can take a message will SAY it took one, which is the "never claim
   * something is recorded without a successful tool result" rule broken by
   * the prompt itself.
   */
  it("names the only tool this surface has, and the two it does not", () => {
    expect(WEB_TOOL_NOTICE).toContain("capture_lead");
    expect(WEB_TOOL_NOTICE).toContain("take_message");
    expect(WEB_TOOL_NOTICE).toContain("log_transcript");
  });

  it("forbids saying a message was taken when no tool took it", () => {
    expect(WEB_TOOL_NOTICE).toMatch(/never say you have taken a message/i);
  });
});

describe("budgetNotice", () => {
  it("says nothing while the conversation still has room", () => {
    // MUTATION: drop the `remaining > CONCIERGE_BUDGET_WARN_TURNS` early
    // return — this FAILS, and every turn of every conversation carries a
    // "we are nearly out of time" instruction.
    expect(budgetNotice(CONCIERGE_BUDGET_WARN_TURNS + 1)).toBe("");
  });

  it("names how many replies are left and asks for a way to reach them", () => {
    const notice = budgetNotice(3);
    expect(notice).toContain("3");
    expect(notice.toLowerCase()).toContain("email");
    expect(notice.toLowerCase()).toContain("phone");
    expect(notice.toLowerCase()).toContain("name");
  });

  it("counts one reply in the singular, because a model reads the grammar", () => {
    expect(budgetNotice(1)).toContain("1 more reply");
    expect(budgetNotice(2)).toContain("2 more replies");
  });

  it("tells her the last reply is a close, not another question", () => {
    expect(budgetNotice(1).toLowerCase()).toContain("do not ask a question");
  });
});
