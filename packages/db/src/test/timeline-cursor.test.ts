import { describe, it, expect } from "vitest";
import {
  instantKey, isTimelineInstant, timelineBeforeFilter, withTimelinePage, TIMELINE_PAGE_SIZE,
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
