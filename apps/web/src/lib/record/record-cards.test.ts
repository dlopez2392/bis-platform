import { describe, it, expect } from "vitest";
import { RECORD_CARDS, GROUP_RECORD_CARDS, cardsInPhoneOrder, columnRuns } from "./record-cards";
import { m } from "@/lib/messages";

describe("the record card registry (S-03 part 1, spec §8)", () => {
  it("ids are unique", () => {
    const ids = RECORD_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("phone order is exactly D6's: summary, Next up, the timeline, what they have, who they are (mutation: swap timeline's and summary's phoneOrder -> FAILS)", () => {
    expect(cardsInPhoneOrder(RECORD_CARDS).map((c) => c.id)).toEqual(
      ["summary", "next-up", "timeline", "groups", "properties", "deals", "documents", "details", "tags", "related-people"]);
  });
  it("each column is ONE unbroken run in phone order, so the DOM can be the phone order on a desk too (C6; mutation: give tags phoneOrder 3.5 -> FAILS)", () => {
    expect(columnRuns(RECORD_CARDS).map((r) => r.column)).toEqual(["happening", "have", "who"]);
  });
  it("within a column, desk order agrees with phone order", () => {
    for (const run of columnRuns(RECORD_CARDS)) {
      expect(run.cards.map((c) => c.deskOrder)).toEqual([...run.cards.map((c) => c.deskOrder)].sort((a, b) => a - b));
    }
  });
  it("only the 'what they have' cards collapse on a phone (D6)", () => {
    expect(RECORD_CARDS.filter((c) => c.collapsibleOnPhone).map((c) => c.id).sort()).toEqual(["deals", "documents", "groups", "properties"]);
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

describe("the group record page's cards (S-03 part 2, spec §7)", () => {
  it("ids are unique", () => {
    const ids = GROUP_RECORD_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("2b's phone order is DESIGN.md's: the summary, Next up, the timeline, what they have, then who they are (spec §7; mutation: swap people's and timeline's phoneOrder -> FAILS)", () => {
    expect(cardsInPhoneOrder(GROUP_RECORD_CARDS).map((c) => c.id)).toEqual(
      ["summary", "next-up", "timeline", "properties", "deals", "documents", "people", "details"]);
    expect(columnRuns(GROUP_RECORD_CARDS).map((r) => r.column)).toEqual(["happening", "have", "who"]);
  });
  it("the middle column's rows are the spec §7 table's: desk order, titles, skeletons, never closed on a phone (mutation: give the timeline 3 skeleton rows -> FAILS)", () => {
    expect(GROUP_RECORD_CARDS.filter((c) => c.column === "happening")
      .map((c) => [c.id, c.deskOrder, c.titleKey, c.skeletonRows, c.collapsibleOnPhone])).toEqual([
      ["summary", 1, "record.card.summary", 1, false],
      ["next-up", 2, "record.card.nextUp", 3, false],
      ["timeline", 3, "record.card.activity", 5, false],
    ]);
  });
  it("within a column, desk order agrees with phone order", () => {
    for (const run of columnRuns(GROUP_RECORD_CARDS)) {
      expect(run.cards.map((c) => c.deskOrder)).toEqual([...run.cards.map((c) => c.deskOrder)].sort((a, b) => a - b));
    }
  });
  it("only Properties, Deals and Documents collapse on a phone", () => {
    expect(GROUP_RECORD_CARDS.filter((c) => c.collapsibleOnPhone).map((c) => c.id).sort()).toEqual(["deals", "documents", "properties"]);
  });
  it("every title has a key and a Spanish twin (mutation: delete groupPage.card.people.es -> FAILS naming people)", () => {
    const catalogue: Record<string, string | undefined> = m;
    for (const c of GROUP_RECORD_CARDS) {
      expect(m[c.titleKey], c.id).toBeTruthy();
      expect(catalogue[`${c.titleKey}.es`], `${c.id}: ${c.titleKey}.es`).toBeTruthy();
    }
  });
  it("the contact list's runs are unchanged by the generic (mutation: make columnRuns ignore its argument and read GROUP_RECORD_CARDS -> FAILS)", () => {
    expect(columnRuns(RECORD_CARDS).map((r) => [r.column, r.cards.map((c) => c.id)])).toEqual([
      ["happening", ["summary", "next-up", "timeline"]],
      ["have", ["groups", "properties", "deals", "documents"]],
      ["who", ["details", "tags", "related-people"]],
    ]);
  });
});

describe("the Documents card (S-07 part 1, spec 4.1)", () => {
  it("the Documents card sits last in 'what they have' on both pages, closed on a phone, titled documents.title (spec 4.1; mutation: put it in the who column -> FAILS)", () => {
    for (const cards of [RECORD_CARDS, GROUP_RECORD_CARDS]) {
      const d = cards.find((c) => c.id === "documents")!;
      expect([d.column, d.collapsibleOnPhone, d.titleKey, d.skeletonRows]).toEqual(["have", true, "documents.title", 3]);
      const have = cards.filter((c) => c.column === "have").sort((a, b) => a.deskOrder - b.deskOrder);
      expect(have.at(-1)!.id).toBe("documents");
    }
  });
});
