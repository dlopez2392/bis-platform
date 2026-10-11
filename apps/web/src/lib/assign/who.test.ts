import { describe, it, expect } from "vitest";
import { parseWho, assigneeFilterFor, withWho } from "@/lib/assign/who";

describe("parseWho (spec §9: ?who=mine|unassigned, absent = All)", () => {
  it.each([
    ["mine", "mine"], ["unassigned", "unassigned"], [undefined, "all"], ["MINE", "all"], ["x", "all"],
  ] as const)("%s -> %s", (raw, expected) => {
    expect(parseWho(raw)).toBe(expected);
  });
  it("a duplicated key (an array at runtime) reads as All, never throws", () => {
    expect(parseWho(["mine", "unassigned"] as unknown as string)).toBe("all");
  });
});

describe("assigneeFilterFor", () => {
  it("Mine with no users row (the agency, A5) is All, not an empty filter (mutation: return { who: \"mine\", userId: \"\" } -> FAILS)", () => {
    expect(assigneeFilterFor("mine", null)).toBeUndefined();
  });
  it("Mine names the person", () => {
    expect(assigneeFilterFor("mine", "p1")).toEqual({ who: "mine", userId: "p1" });
  });
  it("Unassigned needs no person", () => {
    expect(assigneeFilterFor("unassigned", null)).toEqual({ who: "unassigned" });
  });
  it("All is no filter", () => {
    expect(assigneeFilterFor("all", "p1")).toBeUndefined();
  });
});

describe("withWho", () => {
  it("All adds no who key", () => {
    expect(withWho({ q: "a" }, "all")).toEqual({ q: "a" });
    expect("who" in withWho({ q: "a" }, "all")).toBe(false);
  });
  it("Mine and Unassigned ride along beside the other params", () => {
    expect(withWho({ q: "a" }, "mine")).toEqual({ q: "a", who: "mine" });
    expect(withWho({}, "unassigned")).toEqual({ who: "unassigned" });
  });
});
