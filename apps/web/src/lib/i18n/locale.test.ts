import { describe, it, expect } from "vitest";
import { resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("user language wins over account language (mutation: swap the precedence → FAILS, since es!=en)", () => {
    expect(resolveLocale("es", "en")).toBe("es");
  });
  it("account language wins when there is no user language", () => {
    expect(resolveLocale(undefined, "es")).toBe("es");
    expect(resolveLocale(null, "es")).toBe("es");
  });
  it("defaults to en when neither is set (mutation: default to 'es' → FAILS)", () => {
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
  });
});
