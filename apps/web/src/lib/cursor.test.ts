import { describe, expect, it } from "vitest";
import { encodeCursor, parseCursor, parseTimeCursor } from "./cursor";

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
