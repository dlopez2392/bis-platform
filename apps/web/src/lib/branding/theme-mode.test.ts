import { describe, it, expect } from "vitest";
import { cookieModeToPersist, resolveThemeMode, THEME_COOKIE } from "./theme-mode";

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

// This shipped broken once and an e2e fixture caught it: the sync effect wrote
// the cookie for whatever next-themes resolved, on every route. /sign-in has no
// tenant to ask, so it resolved "light" and wrote it before the user had even
// signed in — and because the cookie outranks brand_mode, a company that chose
// a dark default would never have seen one.
describe("cookieModeToPersist", () => {
  it("persists the OS answer only when the tenant asked to follow the device", () => {
    expect(cookieModeToPersist("system", "dark")).toBe("dark");
    expect(cookieModeToPersist("system", "light")).toBe("light");
  });

  // The destructive case. A tenant default is something the server re-reads on
  // every request; copying it into the cookie makes it indistinguishable from a
  // deliberate user choice and pins the tenant's own setting out of effect.
  it("never echoes a tenant default back as if the user had chosen it", () => {
    expect(cookieModeToPersist("dark", "dark")).toBeNull();
    expect(cookieModeToPersist("light", "light")).toBeNull();
  });

  it("writes nothing before next-themes has resolved, or for a value it cannot use", () => {
    expect(cookieModeToPersist(undefined, undefined)).toBeNull();
    expect(cookieModeToPersist("system", undefined)).toBeNull();
    expect(cookieModeToPersist("system", "system")).toBeNull();
  });
});
