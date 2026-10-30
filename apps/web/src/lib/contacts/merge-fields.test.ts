import { describe, it, expect } from "vitest";
import { mergeConflicts, alsoKeeps, otherReach } from "./merge-fields";

/**
 * F-006 part 1 (plan Task 10, Step 1): the compare screen's field logic. Pure, mirroring 0106's
 * app.merge_side and the language rule (0106_contact_merge.sql:1001-1014) exactly, so the screen's
 * choices and the database's own rule can never disagree.
 */

describe("mergeConflicts", () => {
  it("a field equal on both sides is not a conflict (mutation: list every field unconditionally -> FAILS)", () => {
    const keep = { first_name: "Maria", last_name: "Garcia", email: "m@x.com", phone: "+19565551111", assigned_to: "u1", language: "en" };
    const other = { ...keep };
    expect(mergeConflicts(keep, other)).toEqual([]);
  });

  it("a blank side is never a conflict, on either side (mutation: treat '' or null as a real value -> FAILS)", () => {
    expect(mergeConflicts({ email: null }, { email: "o@x.com" })).toEqual([]);
    expect(mergeConflicts({ email: "k@x.com" }, { email: "" })).toEqual([]);
    expect(mergeConflicts({ email: "  " }, { email: "o@x.com" })).toEqual([]);
  });

  it("a real disagreement is a conflict, preselecting keep by default", () => {
    expect(mergeConflicts({ email: "k@x.com" }, { email: "o@x.com" })).toEqual([
      { field: "email", keepValue: "k@x.com", otherValue: "o@x.com", preselect: "keep" },
    ]);
  });

  it("language: staff beats a sign (mutation: always preselect 'keep' -> FAILS)", () => {
    const keep = { language: "en", language_source: "sign", language_set_at: "2026-01-01T00:00:00Z" };
    const other = { language: "es", language_source: "staff", language_set_at: "2026-02-01T00:00:00Z" };
    expect(mergeConflicts(keep, other)).toEqual([
      { field: "language", keepValue: "en", otherValue: "es", preselect: "other" },
    ]);
  });

  it("language: with no staff mark, the EARLIER signal wins (mutation: pick the later one -> FAILS)", () => {
    const keep = { language: "en", language_source: "sign", language_set_at: "2026-02-01T00:00:00Z" };
    const other = { language: "es", language_source: "sign", language_set_at: "2026-01-01T00:00:00Z" };
    expect(mergeConflicts(keep, other)[0]!.preselect).toBe("other");
    const keep2 = { language: "en", language_source: "sign", language_set_at: "2026-01-01T00:00:00Z" };
    const other2 = { language: "es", language_source: "sign", language_set_at: "2026-02-01T00:00:00Z" };
    expect(mergeConflicts(keep2, other2)[0]!.preselect).toBe("keep");
  });

  it("custom keys present on only one side are not conflicts: missing on the other reads as blank there (mutation: drop the blank check and keep only k !== o -> FAILS, since undefined !== 'x')", () => {
    const keep = { custom: { favoriteColor: "blue" } };
    const other = { custom: { favoriteColor: "blue", onlyOnOther: "x" } };
    expect(mergeConflicts(keep, other)).toEqual([]);
    // The reverse direction too: a key only on keep's side.
    expect(mergeConflicts({ custom: { onlyOnKeep: "x" } }, { custom: {} })).toEqual([]);
  });

  it("custom keys on both sides that differ are conflicts, named custom.<key>", () => {
    const keep = { custom: { favoriteColor: "blue" } };
    const other = { custom: { favoriteColor: "red" } };
    expect(mergeConflicts(keep, other)).toEqual([
      { field: "custom.favoriteColor", keepValue: "blue", otherValue: "red", preselect: "keep" },
    ]);
  });
});

describe("alsoKeeps", () => {
  it("lists fields blank on the kept side and present on the other (mutation: ignore blanks -> FAILS)", () => {
    expect(alsoKeeps({ email: null, phone: "+1" }, { email: "o@x.com", phone: "+1" })).toEqual(["email"]);
  });
  it("lists a custom key present only on the other side", () => {
    expect(alsoKeeps({ custom: {} }, { custom: { onlyOnOther: "x" } })).toEqual(["custom.onlyOnOther"]);
  });
  it("a blank language on the kept side is filled from the other", () => {
    expect(alsoKeeps({ language: null }, { language: "es" })).toEqual(["language"]);
  });
});

describe("otherReach", () => {
  it("names the other's phone when the resolved kept phone differs from it (mutation: compare the raw kept phone, ignoring choices -> FAILS)", () => {
    const keep = { phone: "+19565551111" };
    const other = { phone: "+19565552222" };
    expect(otherReach(keep, other, {})).toEqual({ phone: "+19565552222" });
    expect(otherReach(keep, other, { phone: "other" })).toEqual({});
  });
  it("names nothing when the other side has no phone or email", () => {
    expect(otherReach({ phone: "+1" }, { phone: null }, {})).toEqual({});
  });
});
