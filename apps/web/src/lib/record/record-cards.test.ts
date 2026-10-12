import { describe, it, expect } from "vitest";
import { RECORD_CARDS, cardsInPhoneOrder, columnRuns } from "./record-cards";
import { m } from "@/lib/messages";

describe("the record card registry (S-03 part 1, spec §8)", () => {
  it("ids are unique", () => {
    const ids = RECORD_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("phone order is exactly D6's: summary, Next up, the timeline, what they have, who they are (mutation: swap timeline's and summary's phoneOrder -> FAILS)", () => {
    expect(cardsInPhoneOrder().map((c) => c.id)).toEqual(
      ["summary", "next-up", "timeline", "groups", "properties", "deals", "details", "tags", "related-people"]);
  });
  it("each column is ONE unbroken run in phone order, so the DOM can be the phone order on a desk too (C6; mutation: give tags phoneOrder 3.5 -> FAILS)", () => {
    expect(columnRuns().map((r) => r.column)).toEqual(["happening", "have", "who"]);
  });
  it("within a column, desk order agrees with phone order", () => {
    for (const run of columnRuns()) {
      expect(run.cards.map((c) => c.deskOrder)).toEqual([...run.cards.map((c) => c.deskOrder)].sort((a, b) => a - b));
    }
  });
  it("only the three 'what they have' cards collapse on a phone (D6)", () => {
    expect(RECORD_CARDS.filter((c) => c.collapsibleOnPhone).map((c) => c.id).sort()).toEqual(["deals", "groups", "properties"]);
  });
  it("every card has a title key in the catalogue and a skeleton shaped as the spec says", () => {
    for (const c of RECORD_CARDS) {
      expect(m[c.titleKey], c.id).toBeTruthy();
      expect(c.skeletonRows, c.id).toBeGreaterThanOrEqual(1);
    }
    expect(RECORD_CARDS.find((c) => c.id === "next-up")!.skeletonRows).toBe(3);
    expect(RECORD_CARDS.find((c) => c.id === "timeline")!.skeletonRows).toBe(5);
    expect(RECORD_CARDS.find((c) => c.id === "summary")!.skeletonRows).toBe(1);
  });
  it("every card's title has a Spanish twin, so a Spanish record page has no English title (spec §9.6; mutation: delete contact.tags.es -> FAILS naming tags)", () => {
    const catalogue: Record<string, string | undefined> = m;
    for (const c of RECORD_CARDS) {
      expect(catalogue[`${c.titleKey}.es`], `${c.id}: ${c.titleKey}.es`).toBeTruthy();
    }
  });
});
