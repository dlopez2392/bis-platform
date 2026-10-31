import { describe, it, expect } from "vitest";
import { nameRanges, phoneRanges, splitByRanges } from "./search-highlight";

describe("nameRanges", () => {
  it("highlights one folded token (accent in the stored name)", () => {
    expect(nameRanges("Garc\u00eda", "garcia")).toEqual([[0, 6]]);
  });

  it("highlights two tokens typed in any order (full name)", () => {
    expect(nameRanges("Mar\u00eda Garc\u00eda L\u00f3pez", "garcia maria")).toEqual([[0, 5], [6, 12]]);
  });

  it("\u00f1 and n match both ways (Q1)", () => {
    expect(nameRanges("Pe\u00f1a", "pena")).toEqual([[0, 4]]);
  });

  it("a combining-mark accent is folded into the letter it rides on, not left as a separate hit boundary (mutation: drop the combining-mark line -> [[0, 4]])", () => {
    expect(nameRanges("Jose\u0301 P\u00e9rez", "jose")).toEqual([[0, 5]]);
  });

  it("advances the original-text cursor by UTF-16 code units, not by code points (mutation: advance the offset by 1 per code point instead of ch.length -> [[2, 5]])", () => {
    expect(nameRanges("\u{1F600} Ana", "ana")).toEqual([[3, 6]]);
  });

  it("an apostrophe folds to a space but still occupies a slot in the displayed text", () => {
    expect(nameRanges("O'Brien", "brien")).toEqual([[2, 7]]);
  });

  it("every occurrence of a token is highlighted", () => {
    expect(nameRanges("Ana Anabel", "ana")).toEqual([[0, 3], [4, 7]]);
  });

  it("overlapping ranges from two tokens are merged into one (mutation: skip merge -> two separate ranges)", () => {
    expect(nameRanges("Ana", "an ana")).toEqual([[0, 3]]);
  });

  it("no token in the query means no ranges", () => {
    expect(nameRanges("Garc\u00eda", "")).toEqual([]);
  });

  it("empty displayed text means no ranges", () => {
    expect(nameRanges("", "garcia")).toEqual([]);
  });
});

describe("phoneRanges", () => {
  it("highlights the typed digits inside a formatted number", () => {
    expect(phoneRanges("(956) 555-0199", "0199")).toEqual([[10, 14]]);
  });

  it("highlights a longer typed run across the formatting punctuation", () => {
    expect(phoneRanges("(956) 555-0199", "555-0199")).toEqual([[6, 14]]);
  });

  it("falls back to the national ten digits when the key does not fit the stored number (legacy Mexican mobile shape)", () => {
    expect(phoneRanges("+52 899 123 4567", "044 899 123 4567")).toEqual([[4, 16]]);
  });

  it("a name query highlights nothing in a phone", () => {
    expect(phoneRanges("(956) 555-0199", "garcia")).toEqual([]);
  });

  // T5's keptKey (ContactSearchPlan): af5976fa's digits for this term, when the new key/national
  // pair does not cover them — a row the list found through that kept clause, so its digits still
  // get marked (mutation: drop keptKey from the needle list -> both these return []).
  // F-092 final review M-4b: the row was found because its STORED key (country code folded off: "9562195612")
  // holds "1956" — at "...2 1956 12", the later run, never the "+1 956" at the front (which spans the country
  // code the stored key does not have). This test used to pin [[1, 5]], the front run the server did not match.
  it("falls back to the kept af5976fa digits for a short +1 term the new key strips too much to find, marking the run the stored key holds", () => {
    expect(phoneRanges("+19562195612", "+1 956")).toEqual([[6, 10]]);
  });

  it("marks the last occurrence, after the country code, never one that spans it (mutation: indexOf instead of lastIndexOf -> [[1, 7]])", () => {
    expect(phoneRanges("+1 (956) 555-1956", "1956")).toEqual([[13, 17]]);
  });

  it("falls back to the kept af5976fa digits for a short +521 term the new key strips too much to find", () => {
    expect(phoneRanges("+5218991234567", "+521 899 12")).toEqual([[1, 9]]);
  });

  it("empty displayed text means no ranges", () => {
    expect(phoneRanges("", "0199")).toEqual([]);
  });
});

describe("splitByRanges", () => {
  it("joins back to the original text with no ranges (one plain part)", () => {
    expect(splitByRanges("Garc\u00eda", [])).toEqual([{ text: "Garc\u00eda", hit: false }]);
  });

  it("marks a single range covering the whole text", () => {
    expect(splitByRanges("Garc\u00eda", [[0, 6]])).toEqual([{ text: "Garc\u00eda", hit: true }]);
  });

  it("alternates plain and hit parts, with no empty parts, for two separate ranges (full-name case)", () => {
    const text = "Mar\u00eda Garc\u00eda L\u00f3pez";
    const parts = splitByRanges(text, [[0, 5], [6, 12]]);
    expect(parts).toEqual([
      { text: "Mar\u00eda", hit: true },
      { text: " ", hit: false },
      { text: "Garc\u00eda", hit: true },
      { text: " L\u00f3pez", hit: false },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });

  it("a mid-text range leaves a leading and a trailing plain part, with no empty parts", () => {
    const text = "(956) 555-0199";
    const parts = splitByRanges(text, [[10, 14]]);
    expect(parts).toEqual([
      { text: "(956) 555-", hit: false },
      { text: "0199", hit: true },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
  });

  it("round-trips every case above: joined parts equal the original text", () => {
    const cases: [string, [number, number][]][] = [
      ["Garc\u00eda", [[0, 6]]],
      ["Mar\u00eda Garc\u00eda L\u00f3pez", [[0, 5], [6, 12]]],
      ["Pe\u00f1a", [[0, 4]]],
      ["Jose\u0301 P\u00e9rez", [[0, 5]]],
      ["\u{1F600} Ana", [[3, 6]]],
      ["O'Brien", [[2, 7]]],
      ["Ana Anabel", [[0, 3], [4, 7]]],
      ["Ana", [[0, 3]]],
      ["(956) 555-0199", [[10, 14]]],
      ["(956) 555-0199", [[6, 14]]],
      ["+52 899 123 4567", [[4, 16]]],
    ];
    for (const [text, ranges] of cases) {
      expect(splitByRanges(text, ranges).map((p) => p.text).join("")).toBe(text);
    }
  });

  it("produces no empty-string parts (mutation: push an empty leading part when a range starts at 0 -> FAILS)", () => {
    for (const p of splitByRanges("Garc\u00eda", [[0, 6]])) expect(p.text.length).toBeGreaterThan(0);
    for (const p of splitByRanges("(956) 555-0199", [[10, 14]])) expect(p.text.length).toBeGreaterThan(0);
  });
});
