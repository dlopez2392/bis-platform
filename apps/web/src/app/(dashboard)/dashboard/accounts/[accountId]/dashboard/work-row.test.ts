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
});
