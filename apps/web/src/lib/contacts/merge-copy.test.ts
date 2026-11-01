import { describe, it, expect } from "vitest";
import type { MergeCountKey } from "@bis/db";
import { m } from "@/lib/messages";
import { plural, type PluralKey } from "@/lib/i18n/t";
import { makeTr } from "@/lib/record/copy";
import { mergeCountsList, mergeCountsTotal } from "./merge-copy";

/**
 * F-006 part 1 (plan Task 9, Step 1): the moves line's counted phrases, joined by Intl.ListFormat. The
 * expected string is built from the SAME catalogue the function reads, never a literal comma rule —
 * so a translation edit cannot desync this test from the real copy.
 */
const phrase = (key: PluralKey<typeof m>, n: number, locale: "en" | "es") => plural(m, key, n, locale, { count: n });
const want = (locale: "en" | "es", phrases: string[]) =>
  new Intl.ListFormat(locale === "es" ? "es-US" : "en-US", { type: "conjunction" }).format(phrases);

describe("mergeCountsList (plan Task 9): the merge's moves, as one phrase", () => {
  it("counted phrases with their One twins, joined by Intl.ListFormat (mutation: ignore the One twin -> the 1 appointment case FAILS)", () => {
    const tr = makeTr("en");
    const counts: Partial<Record<MergeCountKey, number>> = { messages: 12, calls: 3, bookings: 1 };
    const expected = want("en", [
      phrase("contacts.merge.count.messages", 12, "en"),
      phrase("contacts.merge.count.calls", 3, "en"),
      phrase("contacts.merge.count.bookings", 1, "en"),
    ]);
    expect(mergeCountsList(counts, tr, "en")).toBe(expected);
    expect(mergeCountsList(counts, tr, "en")).toContain("1 appointment");
    expect(mergeCountsList(counts, tr, "en")).not.toContain("1 appointments");
  });

  it("in Spanish, the .es twins (mutation: fall back to English -> FAILS)", () => {
    const tr = makeTr("es");
    const counts: Partial<Record<MergeCountKey, number>> = { notes: 2, tasks: 1 };
    const expected = want("es", [phrase("contacts.merge.count.notes", 2, "es"), phrase("contacts.merge.count.tasks", 1, "es")]);
    expect(mergeCountsList(counts, tr, "es")).toBe(expected);
  });

  it("a zero count is left out, and {} is \"\" (mutation: include a zero -> FAILS)", () => {
    const tr = makeTr("en");
    expect(mergeCountsList({ messages: 0, calls: 2 }, tr, "en")).toBe(want("en", [phrase("contacts.merge.count.calls", 2, "en")]));
    expect(mergeCountsList({}, tr, "en")).toBe("");
  });

  it("follows MERGE_COUNT_KEYS order regardless of the object's own key order (mutation: iterate Object.keys(counts) -> FAILS)", () => {
    const tr = makeTr("en");
    const counts: Partial<Record<MergeCountKey, number>> = { tasks: 1, messages: 2 };
    const expected = want("en", [phrase("contacts.merge.count.messages", 2, "en"), phrase("contacts.merge.count.tasks", 1, "en")]);
    expect(mergeCountsList(counts, tr, "en")).toBe(expected);
  });
});

// S-10 T9a: the grammatical number for the SENTENCE wrapped around the
// list (timeline-rows.ts's "merge" row), which depends on the TOTAL moved,
// never on how many categories are nonzero.
describe("mergeCountsTotal (S-10 T9a)", () => {
  it("sums every counted category (mutation: count nonzero categories instead of summing -> FAILS)", () => {
    expect(mergeCountsTotal({ messages: 12, calls: 3, bookings: 1 })).toBe(16);
  });

  it("one category with 1 item sums to 1 (mutation: return the category count unconditionally -> FAILS)", () => {
    expect(mergeCountsTotal({ notes: 1 })).toBe(1);
  });

  it("two categories each with 1 item sum to 2, not 1 (mutation: count categories, not items -> FAILS)", () => {
    expect(mergeCountsTotal({ notes: 1, calls: 1 })).toBe(2);
  });

  it("{} sums to 0 (mutation: default a missing key to 1 -> FAILS)", () => {
    expect(mergeCountsTotal({})).toBe(0);
  });
});
