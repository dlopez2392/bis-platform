import { describe, it, expect } from "vitest";
import type { DuplicatePair } from "@bis/db";
import { toRowCursor, fromRowCursor, compareHref, reasonMessageKey } from "./duplicates";

/** F-006 part 1 (plan Task 10, Step 2): the duplicates list's own column cursor and the compare link. */

const PAIR: DuplicatePair = {
  id: "flag-1",
  a: { id: "11111111-1111-4111-8111-111111111111", firstName: "Maria", lastName: "Garcia" },
  b: { id: "22222222-2222-4222-8222-222222222222", firstName: "Maria", lastName: "G" },
  reason: "same_phone",
  strength: 1,
  createdAt: "2026-10-29T07:00:00.123456+00:00",
};

describe("toRowCursor / fromRowCursor", () => {
  it("round-trips strength and createdAt through one '|'-joined value", () => {
    const rc = toRowCursor(PAIR);
    expect(rc).toEqual({ v: "1|2026-10-29T07:00:00.123456+00:00", id: "flag-1" });
    expect(fromRowCursor(rc)).toEqual({ strength: 1, createdAt: "2026-10-29T07:00:00.123456+00:00", id: "flag-1" });
  });

  it("is total: undefined, a null v, a strength outside 1-9, a v with no '|' or two, and an unparseable instant all answer undefined", () => {
    expect(fromRowCursor(undefined)).toBeUndefined();
    expect(fromRowCursor({ v: null, id: "x" })).toBeUndefined();
    expect(fromRowCursor({ v: "0|2026-10-29T07:00:00Z", id: "x" })).toBeUndefined();
    expect(fromRowCursor({ v: "10|2026-10-29T07:00:00Z", id: "x" })).toBeUndefined();
    expect(fromRowCursor({ v: "1", id: "x" })).toBeUndefined();
    expect(fromRowCursor({ v: "1|2026-10-29T07:00:00Z|extra", id: "x" })).toBeUndefined();
    expect(fromRowCursor({ v: "1|not-a-date", id: "x" })).toBeUndefined();
  });
});

describe("reasonMessageKey", () => {
  it("maps every reason to its words key, unknown reasons to 'other' (mutation: map phone_country_twin to sameEmail -> FAILS)", () => {
    expect(reasonMessageKey("same_phone")).toBe("contacts.duplicates.reason.samePhone");
    expect(reasonMessageKey("phone_country_twin")).toBe("contacts.duplicates.reason.sameDigits");
    expect(reasonMessageKey("same_email")).toBe("contacts.duplicates.reason.sameEmail");
    expect(reasonMessageKey("same_name")).toBe("contacts.duplicates.reason.sameName");
    expect(reasonMessageKey("email_phone_conflict")).toBe("contacts.duplicates.reason.other");
  });
});

describe("compareHref", () => {
  it("builds the merge route with a and b (mutation: swap in a stale literal path -> FAILS)", () => {
    expect(compareHref("acct-1", PAIR)).toBe(
      "/dashboard/accounts/acct-1/contacts/merge?a=11111111-1111-4111-8111-111111111111&b=22222222-2222-4222-8222-222222222222",
    );
  });
  it("carries keep when given", () => {
    expect(compareHref("acct-1", PAIR, PAIR.b.id)).toBe(
      "/dashboard/accounts/acct-1/contacts/merge?a=11111111-1111-4111-8111-111111111111&b=22222222-2222-4222-8222-222222222222&keep=22222222-2222-4222-8222-222222222222",
    );
  });
});
