import { describe, it, expect } from "vitest";
import {
  parseCaptureLead, splitName, budgetNotice, CAPTURE_LEAD_TOOL,
  CONCIERGE_BUDGET_WARN_TURNS,
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

// `WEB_TOOL_NOTICE` is gone (review of commit 129b43f, Important 2): it was
// appended AFTER a base prompt that still told the model to take a message,
// log a transcript, and ask for a callback number, so it forbade CLAIMING a
// tool result without stopping the model from OFFERING the tool in the first
// place. Its substance moved into `system-prompt.ts`'s own `onWeb` branch —
// see `system-prompt.test.ts`'s "the web prompt never promises a tool it was
// not given" block for the coverage that replaces this describe.

describe("budgetNotice", () => {
  /**
   * `remaining` counts the reply being WRITTEN, not the ones after it — see
   * Important 3 in the review of commit 129b43f. `claimConciergeTurn`
   * returns 1…CONCIERGE_MAX_TURNS, and the caller passes
   * `CONCIERGE_MAX_TURNS - claimed + 1`, so `remaining === 1` means THIS
   * reply is the last one, not that one more is coming.
   */
  // Minor 2 (second-round review of 108b822): with `remaining` counting the
  // reply being written, the OLD constant (3) opened the window at
  // remaining=3 — this reply plus two more, i.e. only TWO visitor answers
  // after the notice first appears, where the docstring above promises
  // three exchanges. The constant must be 4 so the first warned reply
  // (remaining=4) is followed by three more (3, 2, 1) before the cap.
  it("pins the first warned turn at 4 replies remaining, and stays silent one turn earlier — the docstring's promise of three answers after the warning", () => {
    // MUTATION: leave CONCIERGE_BUDGET_WARN_TURNS at 3 — this FAILS, because
    // budgetNotice(4) would still be silent (4 > 3), and the warning would
    // fire one reply later than the docstring promises.
    expect(budgetNotice(4)).toContain("ALMOST OVER");
    expect(budgetNotice(5)).toBe("");
  });

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

  it("marks only the truly last reply as the close, not an almost-last one", () => {
    // remaining === 1: this reply IS the last one — zero more after it.
    expect(budgetNotice(1).toLowerCase()).toContain("last reply");
    // remaining === 2: one more reply exists after this one — it must not
    // read as though THIS were the last.
    expect(budgetNotice(2)).toContain("2");
    expect(budgetNotice(2).toLowerCase()).not.toContain("last reply");
  });

  it("tells her the last reply is a close, not another question", () => {
    expect(budgetNotice(1).toLowerCase()).toContain("do not ask a question");
  });

  it("does not tell her one more reply is coming when this IS the last one", () => {
    // MUTATION (Important 3): the old wording said "1 more reply" at
    // remaining === 1, which is what "displaced the incoherence by one
    // turn" — the model was told to close NEXT turn on the turn it must
    // close NOW. This FAILS if that phrasing comes back.
    expect(budgetNotice(1)).not.toContain("1 more reply");
  });
});
