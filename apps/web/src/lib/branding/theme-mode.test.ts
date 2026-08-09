import { describe, it, expect } from "vitest";
import { resolveThemeMode, THEME_COOKIE } from "./theme-mode";

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

  it("names the cookie", () => {
    expect(THEME_COOKIE).toBe("bis-theme");
  });
});
