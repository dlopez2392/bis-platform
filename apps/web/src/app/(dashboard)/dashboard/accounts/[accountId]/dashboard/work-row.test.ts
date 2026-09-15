import { describe, it, expect } from "vitest";
import { workRowText } from "./work-row";

describe("workRowText", () => {
  it("leads with the total and adds the overdue breakdown when there is one", () => {
    expect(workRowText(7, 2)).toBe("7 things to do · 2 overdue");
  });
  it("omits the breakdown when nothing is dated", () => {
    expect(workRowText(7, 0)).toBe("7 things to do");
  });
  it("says so plainly when the queue is empty, rather than vanishing", () => {
    expect(workRowText(0, 0)).toBe("Nothing needs you right now.");
  });
  // A count of exactly one is the designed first experience (spec §3 —
  // dismissing is what first populates `tasks`), not an edge case, and this
  // namespace's own convention (contacts.count/contacts.countOne in
  // messages.ts) is a whole-phrase pick by count, never a plural template
  // reused for one.
  it("takes the singular phrase when the total is exactly one", () => {
    expect(workRowText(1, 0)).toBe("1 thing to do");
  });
  it("keeps the singular phrase ahead of an overdue breakdown too", () => {
    expect(workRowText(1, 1)).toBe("1 thing to do · 1 overdue");
  });
});
