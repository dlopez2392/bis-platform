import { describe, it, expect } from "vitest";
import { numberStatusLabel } from "./number-status";

// S-10 T9b: numberStatusLabel replaced the eager NUMBER_STATUS_LABEL
// constant (English-only `m[...]` reads at module load) with a lazy,
// locale-parameterised function — this file's own m[...] reads went from
// 4 (one per status) to zero.
describe("numberStatusLabel", () => {
  it("names all four statuses in English by default (mutation: hard-code a different word → FAILS)", () => {
    expect(numberStatusLabel("provisioned")).toBe("Provisioned");
    expect(numberStatusLabel("testing")).toBe("Testing");
    expect(numberStatusLabel("live")).toBe("Live");
    expect(numberStatusLabel("released")).toBe("Released");
  });

  it("reads Spanish when asked (mutation: ignore the locale argument → FAILS)", () => {
    expect(numberStatusLabel("live", "es")).toBe("Activo");
    expect(numberStatusLabel("provisioned", "es")).toBe("Asignado");
  });
});
