import { describe, it, expect } from "vitest";
import {
  instantKey, isTimelineInstant, timelineBeforeFilter, withTimelinePage, TIMELINE_PAGE_SIZE,
  forContacts, encodeBigintCursorId, decodeBigintCursorId, withBigintTimelinePage,
} from "../timeline-cursor";

const ID = "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";

describe("instantKey: one total order across seven tables, to the microsecond (spec C3)", () => {
  it("the same instant spelled three ways is one key (mutation: compare the raw strings -> FAILS)", () => {
    const k = instantKey("2026-10-09T16:12:00.120000+00:00");
    expect(instantKey("2026-10-09T16:12:00.12Z")).toBe(k);
    expect(instantKey("2026-10-09T11:12:00.12-05:00")).toBe(k);
  });
  it("orders by microseconds, which Date drops (mutation: key on Date.parse alone -> FAILS)", () => {
    expect(instantKey("2026-10-09T16:12:00.000002Z") > instantKey("2026-10-09T16:12:00.000001Z")).toBe(true);
    expect(instantKey("2026-10-09T16:12:00.000001Z") > instantKey("2026-10-09T16:12:00Z")).toBe(true);
    expect(instantKey("2026-10-10T00:00:00Z") > instantKey("2026-10-09T23:59:59.999999Z")).toBe(true);
  });
  it("refuses anything that is not a timestamp with a zone", () => {
    for (const bad of ["", "2026-10-09", "2026-10-09T16:12", "2026-10-09 16:12:00+00", "2026-10-09T16:12:00"]) {
      expect(() => instantKey(bad), bad).toThrow(TypeError);
      expect(isTimelineInstant(bad), bad).toBe(false);
    }
  });
});

describe("isTimelineInstant: a REAL instant, not just a string Date.parse tolerates (apps/web's cursor.ts carries the same rule)", () => {
  it("rejects an impossible calendar date (mutation: drop the daysInMonth check -> FAILS, Date.parse rolls Feb 30 to Mar 2)", () => {
    expect(isTimelineInstant("2026-02-30T00:00:00Z")).toBe(false);
  });
  it("rejects an offset past Postgres's +/-15:59 (mutation: drop the offsetOk check -> FAILS)", () => {
    expect(isTimelineInstant("2026-10-09T16:12:00+16:00")).toBe(false);
  });
  it("accepts the boundary offset +/-15:59", () => {
    expect(isTimelineInstant("2026-10-09T16:12:00+15:59")).toBe(true);
  });
  it("rejects year 0000, which Postgres also refuses (mutation: drop the y >= 1 check -> FAILS)", () => {
    expect(isTimelineInstant("0000-01-01T00:00:00Z")).toBe(false);
  });
});

describe("timelineBeforeFilter: strictly past (at, id), the contact list's row-value idiom", () => {
  it("is exactly `at < v OR (at = v AND id < id)`, quoted (mutation: drop the and(...) half -> FAILS)", () => {
    expect(timelineBeforeFilter("created_at", { v: "2026-10-09T16:12:00.123456+00:00", id: ID })).toBe(
      `created_at.lt."2026-10-09T16:12:00.123456+00:00",and(created_at.eq."2026-10-09T16:12:00.123456+00:00",id.lt.${ID})`);
  });
  it("throws on a cursor that is not a timestamp and a uuid: it never reaches a filter string (mutation: drop the check -> FAILS)", () => {
    expect(() => timelineBeforeFilter("created_at", { v: "x),or(id.gt.0", id: ID })).toThrow(TypeError);
    expect(() => timelineBeforeFilter("created_at", { v: "2026-10-09T16:12:00Z", id: "not-a-uuid" })).toThrow(TypeError);
  });
});

describe("forContacts: one source reads one person (.eq) or a household's set (.in) (S-03 part 2b, C6)", () => {
  const recorder = () => {
    const calls: unknown[][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of ["eq", "in"]) chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
    return { chain, calls };
  };
  it("a single id calls .eq, not .in (mutation: route every call through .in -> the string case FAILS)", () => {
    const { chain, calls } = recorder();
    forContacts(chain, "contact_id", "c1");
    expect(calls).toEqual([["eq", "contact_id", "c1"]]);
  });
  it("a set calls .in with every id, copied out of the readonly array", () => {
    const { chain, calls } = recorder();
    const ids: readonly string[] = ["c1", "c2"];
    forContacts(chain, "contact_id", ids);
    expect(calls).toEqual([["in", "contact_id", ["c1", "c2"]]]);
  });
  it("refuses an empty set: PostgREST's in.() is not a query anyone means (mutation: drop the length guard -> FAILS)", () => {
    const { chain } = recorder();
    expect(() => forContacts(chain, "contact_id", [])).toThrow(TypeError);
    expect(() => forContacts(chain, "contact_id", [])).toThrow("forContacts: an empty set");
  });
});

describe("withTimelinePage", () => {
  const recorder = () => {
    const calls: unknown[][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of ["order", "or", "limit"]) chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
    return { chain, calls };
  };
  it("orders (at desc, id desc), filters past the cursor, and limits (mutation: drop the id order -> FAILS)", () => {
    const { chain, calls } = recorder();
    withTimelinePage(chain, "started_at", { before: { v: "2026-10-09T16:12:00Z", id: ID }, limit: 31 });
    expect(calls).toEqual([
      ["order", "started_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["or", timelineBeforeFilter("started_at", { v: "2026-10-09T16:12:00Z", id: ID })],
      ["limit", 31],
    ]);
  });
  it("the head page has no filter", () => {
    const { chain, calls } = recorder();
    withTimelinePage(chain, "created_at", { limit: TIMELINE_PAGE_SIZE + 1 });
    expect(calls.map((c) => c[0])).toEqual(["order", "order", "limit"]);
    expect(TIMELINE_PAGE_SIZE).toBe(30);
  });
});

// ---------------------------------------------------------------------------------------------
// Timeline paging bug fix: contact_archive_log (0103) and contact_merges (0106) use a BIGINT id,
// not a uuid, so timelineBeforeFilter's `id.lt.<uuid>` broke PostgREST ("invalid input syntax for
// type bigint") on any page whose cursor came from a uuid-id source, and the two tables' own rows
// silently vanished from that page. encodeBigintCursorId/decodeBigintCursorId embed the real
// bigint id into the one UUID shape every reader of the merged cursor already requires (the same
// idea record-changes.ts's encodeChangeCursorId/decodeChangeCursorId already applies to
// record_changes — not imported here, reproduced inline below to prove non-collision without a
// cross-module dependency running the wrong way).
// ---------------------------------------------------------------------------------------------
describe("encodeBigintCursorId / decodeBigintCursorId: a per-source codec for a bigint-id table", () => {
  it("round-trips: decode(encode(source, id)) === id, for the same source (mutation: drop the round-trip re-encode check -> FAILS, see the next test instead for what that check actually buys)", () => {
    expect(decodeBigintCursorId("archive", encodeBigintCursorId("archive", 42))).toBe(42);
    expect(decodeBigintCursorId("merge", encodeBigintCursorId("merge", 7))).toBe(7);
  });
  it("one source's encoded id never decodes as the other's (mutation: drop the round-trip re-encode check, trusting the shape+safe-integer check alone -> FAILS, verified live)", () => {
    expect(decodeBigintCursorId("merge", encodeBigintCursorId("archive", 42))).toBeNull();
    expect(decodeBigintCursorId("archive", encodeBigintCursorId("merge", 42))).toBeNull();
  });
  it("never decodes a real random uuid from a uuid-id source (mutation: drop the Number.isSafeInteger guard, so the uuid's own non-tag digits parse as some huge-but-truthy n -> FAILS)", () => {
    expect(decodeBigintCursorId("archive", ID)).toBeNull();
    expect(decodeBigintCursorId("merge", ID)).toBeNull();
  });
  it("never decodes record_changes's own untagged bigint-as-uuid encoding (encodeChangeCursorId's own documented shape: id 42 zero-padded to 32 hex digits, 8-4-4-4-12 — reproduced literally, not imported; mutation: drop the round-trip re-encode check -> FAILS, verified live)", () => {
    const changeEncodedId42 = "00000000-0000-0000-0000-00000000002a";
    expect(decodeBigintCursorId("archive", changeEncodedId42)).toBeNull();
    expect(decodeBigintCursorId("merge", changeEncodedId42)).toBeNull();
  });
  it("two sources encode the same numeric id to different strings (mutation: drop the tag from the encoding -> FAILS)", () => {
    expect(encodeBigintCursorId("archive", 1)).not.toBe(encodeBigintCursorId("merge", 1));
  });
  it("the encoded id is always UUID-shaped (mutation: drop a dash from the grouping -> FAILS)", () => {
    const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(encodeBigintCursorId("archive", 42)).toMatch(UUID_SHAPE);
    expect(encodeBigintCursorId("merge", 42)).toMatch(UUID_SHAPE);
  });
  it("refuses a non-positive or unsafe id, the same guard timelineBeforeFilter's uuid check stands in for (mutation: drop the guard -> FAILS)", () => {
    expect(() => encodeBigintCursorId("archive", 0)).toThrow(TypeError);
    expect(() => encodeBigintCursorId("archive", -1)).toThrow(TypeError);
    expect(() => encodeBigintCursorId("archive", Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });
});

describe("withBigintTimelinePage: a bigint-id source's own page, past a cursor from ANY source (contact_archive_log 0103, contact_merges 0106)", () => {
  const recorder = () => {
    const calls: unknown[][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of ["order", "or", "limit"]) chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
    return { chain, calls };
  };
  it("orders (col desc, id desc) and limits, with no filter on a cold start", () => {
    const { chain, calls } = recorder();
    withBigintTimelinePage(chain, "created_at", "archive", { limit: 31 });
    expect(calls).toEqual([
      ["order", "created_at", { ascending: false }], ["order", "id", { ascending: false }], ["limit", 31],
    ]);
  });
  it("a cursor from THIS source's own encoding uses the exact (col, id) tie-break, with the real bigint id, UNQUOTED (mutation: quote the id like a uuid -> FAILS)", () => {
    const { chain, calls } = recorder();
    const before = { v: "2026-10-09T16:12:00Z", id: encodeBigintCursorId("archive", 42) };
    withBigintTimelinePage(chain, "created_at", "archive", { before, limit: 31 });
    expect(calls).toEqual([
      ["order", "created_at", { ascending: false }], ["order", "id", { ascending: false }],
      ["or", `created_at.lt."2026-10-09T16:12:00Z",and(created_at.eq."2026-10-09T16:12:00Z",id.lt.42)`],
      ["limit", 31],
    ]);
  });
  it("a cursor from a DIFFERENT source (any uuid-shaped id this source cannot decode as its own) pages on time alone — NEVER a bigint id.lt filter built from a foreign id (mutation: use the exact tie-break anyway -> this would send id.lt.<uuid> to a bigint column, FAILS)", () => {
    const { chain, calls } = recorder();
    const before = { v: "2026-10-09T16:12:00Z", id: ID };
    withBigintTimelinePage(chain, "created_at", "archive", { before, limit: 31 });
    expect(calls).toEqual([
      ["order", "created_at", { ascending: false }], ["order", "id", { ascending: false }],
      ["or", `created_at.lt."2026-10-09T16:12:00Z",created_at.eq."2026-10-09T16:12:00Z"`],
      ["limit", 31],
    ]);
  });
  it("the foreign-cursor fallback is INCLUSIVE (col <= v, never the strict < a uuid source uses): it names the same-instant rule so a same-instant row of this source is never skipped, only ever (rarely) repeated (mutation: drop the eq half, leaving only col.lt -> FAILS; the end-to-end proof that a same-instant row survives the page boundary is timeline-merge.test.ts's own test, over the full merge)", () => {
    const { chain, calls } = recorder();
    withBigintTimelinePage(chain, "merged_at", "merge", { before: { v: "2026-10-09T16:12:00Z", id: ID }, limit: 31 });
    const or = calls.find((c) => c[0] === "or")![1] as string;
    expect(or).toBe(`merged_at.lt."2026-10-09T16:12:00Z",merged_at.eq."2026-10-09T16:12:00Z"`);
  });
  it("throws on a malformed instant: it never reaches the filter grammar (mutation: drop the isTimelineInstant check -> FAILS)", () => {
    const { chain } = recorder();
    expect(() => withBigintTimelinePage(chain, "created_at", "archive", { before: { v: "not-a-timestamp", id: ID }, limit: 31 })).toThrow(TypeError);
  });
});
