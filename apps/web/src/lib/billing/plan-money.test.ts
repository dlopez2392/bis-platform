import { describe, it, expect } from "vitest";
import { formatCents } from "./plan-money";

describe("formatCents", () => {
  it("formatCents is the display value with a dollar sign and thousands commas", () => {
    expect([formatCents(4900), formatCents(3), formatCents(104900)]).toEqual(["$49.00", "$0.03", "$1,049.00"]);
  });

  it("formatCents throws on a negative or non-integer input (mutation: drop the guard → FAILS)", () => {
    expect(() => formatCents(-5)).toThrow();
    expect(() => formatCents(1.5)).toThrow();
  });
});
