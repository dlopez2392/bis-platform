import { describe, it, expect } from "vitest";
import { agendaLanes, type LaneInput } from "./agenda-lanes";

// Monday 2026-09-07 in UTC hours; the lanes compare instants only, so no zone is involved.
const row = (id: string, from: string, to: string, live = true): LaneInput => ({
  id, startsAt: new Date(`2026-09-07T${from}:00.000Z`), endsAt: new Date(`2026-09-07T${to}:00.000Z`), live,
});
const sorted = (s: ReadonlySet<string>) => [...s].sort();

describe("agendaLanes: overlapping live jobs share one item (F-046, spec 5.2, R1)", () => {
  it("two overlapping live jobs are one side-by-side item, and both overlap", () => {
    const out = agendaLanes([row("a", "09:00", "10:00"), row("b", "09:30", "10:30")]);
    expect(out.items).toEqual([{ kind: "side", lanes: [["a"], ["b"]] }]);
    expect(sorted(out.overlapping)).toEqual(["a", "b"]);
  });

  it("back-to-back is two single items and no overlap ([) bounds, as bookings_no_overlap)", () => {
    const out = agendaLanes([row("a", "09:00", "10:00"), row("b", "10:00", "11:00")]);
    expect(out.items).toEqual([{ kind: "single", id: "a" }, { kind: "single", id: "b" }]);
    expect(sorted(out.overlapping)).toEqual([]);
  });

  it("a cancelled job over a live one joins no item and does not overlap", () => {
    const out = agendaLanes([row("a", "09:00", "10:00"), row("x", "09:30", "10:30", false)]);
    expect(out.items).toEqual([{ kind: "single", id: "a" }]);
    expect(sorted(out.overlapping)).toEqual([]);
  });

  it("a chain a-b, b-c with a and c apart is ONE item: a and c share a lane", () => {
    const out = agendaLanes([row("a", "09:00", "10:30"), row("b", "10:00", "11:30"), row("c", "11:00", "12:00")]);
    expect(out.items).toEqual([{ kind: "side", lanes: [["a", "c"], ["b"]] }]);
    expect(sorted(out.overlapping)).toEqual(["a", "b", "c"]);
  });

  it("one long job spanning two short ones that are apart is ONE item: the cluster reaches as far as its longest job", () => {
    const out = agendaLanes([row("a", "09:00", "12:00"), row("b", "09:30", "10:00"), row("c", "11:00", "11:30")]);
    expect(out.items).toEqual([{ kind: "side", lanes: [["a"], ["b", "c"]] }]);
    expect(sorted(out.overlapping)).toEqual(["a", "b", "c"]);
  });

  it("inside an item a job that starts as another ends reuses its lane (back-to-back shares a lane, not a stack)", () => {
    const out = agendaLanes([row("a", "09:00", "10:00"), row("b", "09:30", "10:30"), row("c", "10:00", "11:00")]);
    expect(out.items).toEqual([{ kind: "side", lanes: [["a", "c"], ["b"]] }]);
  });

  it("three mutually overlapping jobs stack", () => {
    const out = agendaLanes([row("a", "09:00", "10:00"), row("b", "09:15", "10:15"), row("c", "09:30", "10:30")]);
    expect(out.items).toEqual([{ kind: "stack", ids: ["a", "b", "c"] }]);
    expect(sorted(out.overlapping)).toEqual(["a", "b", "c"]);
  });

  it("items keep start order whatever the input order, a tie broken by id", () => {
    const out = agendaLanes([
      row("late", "15:00", "16:00"), row("y", "13:00", "14:00"), row("x", "13:00", "13:30"), row("early", "08:00", "09:00"),
    ]);
    expect(out.items).toEqual([
      { kind: "single", id: "early" }, { kind: "side", lanes: [["x"], ["y"]] }, { kind: "single", id: "late" },
    ]);
    expect(sorted(out.overlapping)).toEqual(["x", "y"]);
  });

  it("nothing in, nothing out", () => {
    const out = agendaLanes([]);
    expect(out.items).toEqual([]);
    expect(out.overlapping.size).toBe(0);
  });
});
