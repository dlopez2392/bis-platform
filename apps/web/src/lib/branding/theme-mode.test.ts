import { describe, it, expect } from "vitest";
import { resolveThemeMode, THEME_COOKIE } from "./theme-mode";
import type { ModeName } from "./theme";

describe("resolveThemeMode", () => {
  it("lets the user's stored choice win over the tenant default", () => {
    expect(resolveThemeMode("light", "dark")).toEqual({ serverMode: "light", providerDefault: "light" });
    expect(resolveThemeMode("dark", "light")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  it("falls back to the tenant default with no cookie", () => {
    expect(resolveThemeMode(undefined, "dark")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  it("falls back to light with neither", () => {
    expect(resolveThemeMode(undefined, null)).toEqual({ serverMode: "light", providerDefault: "light" });
  });

  // The one honest wrinkle in the spec: the server cannot know the OS
  // preference, so it paints light and hands next-themes "system" to correct
  // on mount. One frame, once per browser -- the cookie sync writes on resolve.
  it("paints light but defers to the OS when the tenant says follow", () => {
    expect(resolveThemeMode(undefined, "follow")).toEqual({ serverMode: "light", providerDefault: "system" });
  });

  it("still lets a stored choice beat follow", () => {
    expect(resolveThemeMode("dark", "follow")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  it("ignores a cookie value that is not a mode", () => {
    expect(resolveThemeMode("dark;position:fixed", "light")).toEqual({ serverMode: "light", providerDefault: "light" });
  });

  // The two fall-throughs crossed. "system" is a plausible cookie value —
  // next-themes uses that word — and it must not be mistaken for a mode the
  // server can paint, while `follow` still has to reach the OS.
  it("falls through an invalid cookie to follow's own answer", () => {
    expect(resolveThemeMode("system", "follow")).toEqual({ serverMode: "light", providerDefault: "system" });
  });

  it("names the cookie", () => {
    expect(THEME_COOKIE).toBe("bis-theme");
  });
});

/**
 * The bug this milestone shipped with, in miniature: the root layout (which
 * mounts ThemeProvider) and the dashboard shell (which paints the derived
 * tokens) each call resolveThemeMode once, from two different files this
 * repo cannot render a component body for. The two functions below are NOT
 * a re-test of resolveThemeMode's own behaviour above -- they stand in 1:1
 * for those two call sites, so that this file, not the two .tsx files, is
 * where a future edit to either call site gets caught.
 *
 * rootLayoutMode forwards its brandMode argument -- this is the FIXED
 * shape, `resolveThemeMode(cookie, inputs.mode)`. The regression this
 * milestone shipped with hardcoded `null` here instead; the load-bearing
 * check for this test (recorded in task-7-report.md) makes exactly that one
 * edit, confirms the failures below, and reverts it.
 */
function rootLayoutMode(cookie: string | undefined, brandMode: ModeName | null): string {
  return resolveThemeMode(cookie, brandMode).providerDefault;
}

function shellMode(cookie: string | undefined, brandMode: ModeName | null): string {
  return resolveThemeMode(cookie, brandMode).serverMode;
}

describe("the root layout and the dashboard shell agree on a mode", () => {
  const cookies: Array<string | undefined> = [undefined, "light", "dark", "system", "garbage"];
  const brandModes: Array<ModeName | null> = [null, "light", "dark", "follow"];

  for (const cookie of cookies) {
    for (const brandMode of brandModes) {
      it(`cookie=${String(cookie)} brandMode=${String(brandMode)}`, () => {
        const providerDefault = rootLayoutMode(cookie, brandMode);
        const serverMode = shellMode(cookie, brandMode);
        // The one documented exception: brand_mode "follow" with no stored
        // cookie to override it hands next-themes "system" while the server
        // still paints something -- light, by convention -- for that first
        // frame. Every other combination must match exactly, or a document
        // with no `.dark` class would carry dark-derived tokens (or vice
        // versa), which is the defect this milestone shipped with.
        if (providerDefault === "system") {
          expect(serverMode).toBe("light");
        } else {
          expect(serverMode).toBe(providerDefault);
        }
      });
    }
  }
});
