import { describe, it, expect } from "vitest";
import { t, plural } from "./t";

const catalogue: Record<string, string> = {
  "greeting": "Hello, {name}",
  "greeting.es": "Hola, {name}",
  "calls.countOne": "1 call",
  "calls.countOne.es": "1 llamada",
  "calls.count": "{count} calls",
  "calls.count.es": "{count} llamadas",
  "noSpanishTwin": "This key has no Spanish twin",
};

describe("t", () => {
  it("looks up the .es twin and substitutes {params} (mutation: look up key without the .es suffix for es → FAILS, returns English)", () => {
    expect(t(catalogue, "greeting", "es", { name: "Marta" })).toBe("Hola, Marta");
    expect(t(catalogue, "greeting", "en", { name: "Marta" })).toBe("Hello, Marta");
  });

  it("falls back to the English string when no .es twin exists (mutation: drop `?? catalogue[key]` → FAILS, returns the raw key)", () => {
    expect(t(catalogue, "noSpanishTwin", "es")).toBe("This key has no Spanish twin");
    expect(t(catalogue, "noSpanishTwin", "en")).toBe("This key has no Spanish twin");
  });
});

describe("plural", () => {
  it("selects the One-suffixed key for count===1, the base key otherwise, per locale (mutation: always return the base key → FAILS at count=1)", () => {
    expect(plural(catalogue, "calls.count", 1, "en")).toBe("1 call");
    expect(plural(catalogue, "calls.count", 1, "es")).toBe("1 llamada");
    expect(plural(catalogue, "calls.count", 3, "en", { count: 3 })).toBe("3 calls");
    expect(plural(catalogue, "calls.count", 3, "es", { count: 3 })).toBe("3 llamadas");
  });
});
