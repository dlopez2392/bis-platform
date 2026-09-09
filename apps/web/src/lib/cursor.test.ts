import { describe, expect, it } from "vitest";
import { encodeCursor, parseCursor, parseTimeCursor } from "./cursor";

describe("cursor", () => {
  // THE TIMESTAMP IS NOT NORMALISED. Postgres serialises timestamptz with
  // MICROSECONDS and an offset — a real row reads
  // "2026-09-03T17:17:48.364157+00:00", not "…364Z". Both parsers therefore
  // validate the shape and pass the string through untouched; round-tripping
  // it through Date would truncate to milliseconds and could silently skip a
  // row at a page boundary. calls/page.tsx's original comment says exactly
  // this, and a stricter regex here breaks calls paging AND contacts paging.
  it("round-trips a real Postgres timestamp, microseconds and offset intact", () => {
    const c = { at: "2026-09-03T17:17:48.364157+00:00", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e" };
    const out = parseCursor(encodeCursor(c));
    expect(out).toEqual(c);
    expect(out!.at).toContain(".364157");
  });

  it("also accepts the millisecond Z form", () => {
    const c = { at: "2026-09-09T12:00:00.000Z", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e" };
    expect(parseCursor(encodeCursor(c))).toEqual(c);
  });

  // A hand-editable URL parameter. Every one of these must yield undefined
  // (cold start) rather than throwing a 500 on a page a user can reach.
  it.each([undefined, "", "not-a-cursor", "2026-09-09T12:00:00.000Z", "abc|def",
    "2026-09-09T12:00:00.000Z|not-a-uuid", "|", "a|b|c", "9999|x"])(
    "drops the unusable cursor %j", (raw) => {
      expect(parseCursor(raw as string | undefined)).toBeUndefined();
    });

  it("parseTimeCursor keeps calls' EXACT existing behaviour, microseconds included", () => {
    const pg = "2026-01-01T00:00:00.000000+00:00";
    expect(parseTimeCursor(pg)).toBe(pg);
    expect(parseTimeCursor("2026-09-09T12:00:00.000Z")).toBe("2026-09-09T12:00:00.000Z");
    expect(parseTimeCursor("nonsense")).toBeUndefined();
    expect(parseTimeCursor("2026-13-45T99:99:99Z")).toBeUndefined(); // Date.parse rejects
    expect(parseTimeCursor(undefined)).toBeUndefined();
  });
});
