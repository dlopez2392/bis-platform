import { describe, it, expect } from "vitest";
import { t, plural } from "./t";
import { m } from "@/lib/messages";

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

/**
 * I4 (whole-branch review): `t()` keeps compile-time key checking — the spec
 * promised `keyof typeof m`. These are TYPE-level tests: `pnpm --filter web
 * typecheck` is what runs them. If `key` widens back to `string`, the typo
 * below stops being an error and each `@ts-expect-error` becomes an UNUSED
 * directive, which tsc reports as error TS2578 — so the mutation "type `key`
 * as plain string" fails typecheck at exactly these lines.
 */
describe("t / plural keys are checked at compile time (I4)", () => {
  it("a typo'd catalogue key is a type error, a real one is not", () => {
    // @ts-expect-error — "nav.dashbaord" is not a key of the catalogue.
    expect(t(m, "nav.dashbaord", "en")).toBe("nav.dashbaord");
    expect(t(m, "nav.dashboard", "en")).toBe("Dashboard");
  });

  it("plural's base key must have a One twin in the catalogue", () => {
    // @ts-expect-error — "nav.dashboard" has no "nav.dashboardOne" twin.
    expect(plural(m, "nav.dashboard", 2, "en")).toBe("Dashboard");
    expect(plural(m, "shell.presence.idleShort", 1, "es")).toBe("1 llamada");
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
