import { describe, it, expect } from "vitest";
import {
  instantKey, isTimelineInstant, timelineBeforeFilter, withTimelinePage, TIMELINE_PAGE_SIZE,
  forContacts,
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
