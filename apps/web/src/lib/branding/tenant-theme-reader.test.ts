import { describe, it, expect } from "vitest";
import { pickRequestThemeMode } from "./tenant-theme-reader";
import type { ModeName, ThemeInputs } from "./theme";

/**
 * pickRequestThemeMode is the one real call site left for resolveThemeMode
 * -- both the root layout and the dashboard shell now go through
 * getRequestTheme, which calls this. Unlike getRequestTheme itself, this
 * function is pure (no cookies(), no database), so it is the honest place
 * to test that the tenant's `inputs.mode` actually reaches resolveThemeMode
 * rather than, say, a hardcoded `null` -- which is the exact defect this
 * milestone shipped with when the two call sites this replaces still lived
 * in two separate .tsx files.
 */
function inputsWithMode(mode: ModeName | null): ThemeInputs {
  return { color: null, neutral: null, corners: null, type: null, mode };
}

describe("pickRequestThemeMode", () => {
  it("falls back to the tenant's own mode with no cookie", () => {
    expect(pickRequestThemeMode(undefined, inputsWithMode("dark"))).toEqual({
      serverMode: "dark",
      providerDefault: "dark",
    });
  });

  it("lets the user's stored choice win over the tenant default", () => {
    expect(pickRequestThemeMode("light", inputsWithMode("dark"))).toEqual({
      serverMode: "light",
      providerDefault: "light",
    });
  });

  it("falls back to light with neither a cookie nor a tenant mode", () => {
    expect(pickRequestThemeMode(undefined, inputsWithMode(null))).toEqual({
      serverMode: "light",
      providerDefault: "light",
    });
  });

  it("paints light but defers to the OS when the tenant says follow", () => {
    expect(pickRequestThemeMode(undefined, inputsWithMode("follow"))).toEqual({
      serverMode: "light",
      providerDefault: "system",
    });
  });

  // See theme-mode.test.ts for why this changed: providerDefault must stay
  // "system" for a `follow` tenant no matter what the cookie says, or
  // next-themes stops tracking the OS the moment ThemeCookieSync writes its
  // first snapshot. The cookie still wins for serverMode.
  it("keeps providerDefault at system for follow even once a cookie exists", () => {
    expect(pickRequestThemeMode("dark", inputsWithMode("follow"))).toEqual({
      serverMode: "dark",
      providerDefault: "system",
    });
  });
});
