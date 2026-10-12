import { describe, expect, it } from "vitest";
import { encodeCursor, parseCursor, parseTimeCursor, parseTimelineCursor } from "./cursor";

const ID = "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e";

/** Builds a base64url payload the same way `encodeCursor` does, but for
 *  shapes `encodeCursor` itself could never produce — the malformed-input
 *  side of the round-trip contract. */
function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("cursor", () => {
  // The cursor is now OPAQUE: `v` can be a sort value (a name or a company),
  // not just a timestamp, so it can legitimately contain a `|` (the OLD
  // encoding's own separator) or a `+` (which a raw query string decodes to a
  // SPACE, corrupting the old unencoded form). Encoding the pair as base64url
  // JSON instead of `|`-joining removes both hazards at once, rather than
  // trying to pick a separator no real value can contain.
  it("round-trips a value containing the old encoding's own separator, |", () => {
    const c = { v: "Smith|Jones", id: ID };
    expect(parseCursor(encodeCursor(c))).toEqual(c);
  });

  it("round-trips a value containing +, which a raw query string would decode to a space", () => {
    const c = { v: "A+B Roofing", id: ID };
    expect(parseCursor(encodeCursor(c))).toEqual(c);
  });

  // sort_name/company_name are nullable (0030's nulls-last design) — a `null`
  // `v` means the cursor is already inside the null block, and must survive
  // the round trip as JS `null`, not the string "null" or `undefined`.
  it("round-trips a null value", () => {
    const c = { v: null, id: ID };
    expect(parseCursor(encodeCursor(c))).toEqual(c);
  });

  it("drops a string that is not valid base64url JSON", () => {
    // Every character here is in the base64url alphabet, so this exercises
    // the "decodes, but the bytes are not JSON" failure inside the try/catch
    // — not a base64-alphabet rejection, which Node's decoder doesn't do.
    expect(parseCursor("not-a-real-cursor")).toBeUndefined();
  });

  it("drops a well-formed base64url JSON value that isn't a 2-element array", () => {
    expect(parseCursor(b64(["only-one"]))).toBeUndefined();
    expect(parseCursor(b64(["a", "b", "c"]))).toBeUndefined();
    expect(parseCursor(b64({ v: "a", id: ID }))).toBeUndefined();
    expect(parseCursor(b64("a string, not an array"))).toBeUndefined();
  });

  it("drops a well-formed pair whose id is not a uuid", () => {
    expect(parseCursor(b64(["Ana", "not-a-uuid"]))).toBeUndefined();
  });

  it("drops a well-formed pair whose v is neither a string nor null", () => {
    expect(parseCursor(b64([123, ID]))).toBeUndefined();
    expect(parseCursor(b64([true, ID]))).toBeUndefined();
  });

  it("drops undefined and the empty string — the cold-start inputs", () => {
    expect(parseCursor(undefined)).toBeUndefined();
    expect(parseCursor("")).toBeUndefined();
  });

  // Next.js types a searchParams value as `string | string[] | undefined`,
  // and a duplicated query key (`?before=A&before=B`) produces an ARRAY at
  // runtime whatever the page's own annotation says. Both parsers must stay
  // TOTAL against that too: undefined, never a thrown TypeError.
  it("parseCursor returns undefined for an array input rather than throwing", () => {
    expect(parseCursor(["a", "b"] as unknown as string)).toBeUndefined();
  });

  it("parseTimeCursor returns undefined for an array input rather than throwing", () => {
    expect(parseTimeCursor(["a", "b"] as unknown as string)).toBeUndefined();
  });

  // parseTimeCursor is UNTOUCHED by the cursor becoming opaque — `calls`
  // still pages by created_at alone and keeps its own content-validated
  // (not opaque) parser byte-for-byte. Same assertions as before this file
  // changed, unmodified.
  it("parseTimeCursor keeps calls' EXACT existing behaviour, microseconds included", () => {
    const pg = "2026-01-01T00:00:00.000000+00:00";
    expect(parseTimeCursor(pg)).toBe(pg);
    expect(parseTimeCursor("2026-09-09T12:00:00.000Z")).toBe("2026-09-09T12:00:00.000Z");
    expect(parseTimeCursor("nonsense")).toBeUndefined();
    expect(parseTimeCursor("2026-13-45T99:99:99Z")).toBeUndefined(); // Date.parse rejects
    expect(parseTimeCursor(undefined)).toBeUndefined();
  });
});

describe("parseTimelineCursor (S-03 1b, spec §11: a ?before= that does not parse is a cold start)", () => {
  const ID = "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";
  it("round-trips a timestamp cursor exactly, never reformatting it", () => {
    const c = { v: "2026-10-09T16:12:00.123456+00:00", id: ID };
    expect(parseTimelineCursor(encodeCursor(c))).toEqual(c);
  });
  it("anything but a zoned timestamp and a uuid is a cold start (mutation: return parseCursor's result as is -> free text passes, FAILS)", () => {
    for (const v of [null, "Garcia", "2026-10-09", "2026-10-09T16:12", "2026-10-09T16:12:00"]) {
      expect(parseTimelineCursor(encodeCursor({ v, id: ID })), String(v)).toBeUndefined();
    }
    expect(parseTimelineCursor(["a", "b"] as unknown as string)).toBeUndefined();
    expect(parseTimelineCursor("not-base64-json")).toBeUndefined();
  });
  // Date.parse rolls an impossible date over ("Feb 30" is Mar 2), so the shape check and a finite
  // Date.parse both pass it; packages/db's isTimelineInstant does the same. A hand-edited ?before=
  // must still be a cold start here, never a page that throws or silently pages from March.
  it("an impossible calendar date or clock is a cold start (mutation: drop the calendar check -> Feb 30 passes, FAILS)", () => {
    for (const v of ["2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-04-31T12:00:00+00:00", "2026-13-01T00:00:00Z",
      "2026-00-10T00:00:00Z", "2026-10-00T00:00:00Z", "2026-10-09T24:00:00Z", "2026-10-09T23:60:00Z",
      "2026-10-09T23:59:60Z", "2026-10-09T16:12:00+24:00", "2026-10-09T16:12:00+05:60"]) {
      expect(parseTimelineCursor(encodeCursor({ v, id: ID })), v).toBeUndefined();
    }
    for (const v of ["2028-02-29T00:00:00Z", "2026-12-31T23:59:59.999999-06:00", "2026-01-01T00:00:00+14:00"]) {
      expect(parseTimelineCursor(encodeCursor({ v, id: ID })), v).toEqual({ v, id: ID });
    }
  });
});
