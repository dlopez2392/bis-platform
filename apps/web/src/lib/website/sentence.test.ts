import { describe, it, expect } from "vitest";
import { websiteSentence, type SentenceSegment } from "./sentence";

const text = (s: SentenceSegment[]) => s.map((x) => x.text).join("");
const strong = (s: SentenceSegment[]) => s.filter((x) => x.strong).map((x) => x.text);

const base = {
  period: 14 as const, visitors: 1284, priorVisitors: 1088,
  topSource: { name: "Google", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22,
  topPage: { name: "Services", visitors: 412, share: 0.32 }, runnerUpPageShare: 0.20,
  topDevice: { name: "mobile", visitors: 911, share: 0.71 },
};

describe("websiteSentence", () => {
  it("the full sentence, with the bold fragments the mockup shows", () => {
    const s = websiteSentence(base);
    expect(text(s)).toBe("1,284 people visited your website, 18% more than the two weeks before. Most of them found you on Google, the page they read most was Services, and seven in ten were on a phone.");
    expect(strong(s)).toEqual(["1,284 people", "18% more", "Google", "Services"]);
  });
  // Mutation: change SAME_THRESHOLD to 0.5 — this case reads "1% more".
  it("under 5% change reads 'about the same as'", () => {
    expect(text(websiteSentence({ ...base, visitors: 1100, priorVisitors: 1088 })))
      .toMatch(/^1,100 people visited your website, about the same as the two weeks before\./);
  });
  it("fewer is fewer, and the period words follow the period", () => {
    expect(text(websiteSentence({ ...base, period: 7, visitors: 500, priorVisitors: 1000 }))).toContain("50% fewer than the week before");
    expect(text(websiteSentence({ ...base, period: 30 }))).toContain("than the month before");
  });
  // Mutation: change LEAD_MARGIN to 0 — the page clause appears in the first case.
  it("names the top page only with a 10-point lead over the runner-up; the top source likewise", () => {
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.30 }))).not.toContain("the page they read most");
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.20 }))).toContain("the page they read most was Services");
    expect(text(websiteSentence({ ...base, runnerUpSourceShare: 0.55 }))).not.toContain("found you on");
  });
  it("names a device only at 60% share, in tenths, and 'a computer' for desktop", () => {
    expect(text(websiteSentence({ ...base, topDevice: { name: "desktop", visitors: 1, share: 0.64 } }))).toContain("six in ten were on a computer");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.55 } }))).not.toContain("in ten");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.97 } }))).toContain("nearly all of them were on a phone");
  });
  // Mutation: change PLAIN_COUNT_BELOW to 2 — the 14-visitor case grows a percentage.
  it("under 20 visitors: the plain count and nothing else, so a tiny site never reads '200% more'", () => {
    expect(text(websiteSentence({ ...base, visitors: 14, priorVisitors: 3 }))).toBe("14 people visited your website in the last two weeks.");
    expect(text(websiteSentence({ ...base, visitors: 1, priorVisitors: 0 }))).toBe("1 person visited your website in the last two weeks.");
    expect(text(websiteSentence({ ...base, visitors: 0, priorVisitors: 0 }))).toBe("No one has visited your website in the last two weeks yet.");
  });
  it("a zero prior period never divides: it reads as a plain count too", () => {
    expect(text(websiteSentence({ ...base, visitors: 40, priorVisitors: 0 }))).toMatch(/^40 people visited your website in the last two weeks\./);
  });
  it("a Direct lead is never announced as 'found you on'", () => {
    expect(text(websiteSentence({ ...base, topSource: { name: "Direct", visitors: 700, share: 0.6 }, runnerUpSourceShare: 0.2 }))).not.toContain("found you on");
  });
});
