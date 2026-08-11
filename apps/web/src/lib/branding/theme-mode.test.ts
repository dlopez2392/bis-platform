import { describe, it, expect } from "vitest";
import {
  cookieModeToMigrate,
  cookieModeToPersist,
  readCookieValue,
  resolveThemeMode,
  THEME_COOKIE,
} from "./theme-mode";

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

  // Was "still lets a stored choice beat follow", asserting providerDefault
  // "dark" here. That pinned the Fix-2 bug: a `follow` tenant's cookie is not
  // a deliberate choice, it is ThemeCookieSync's snapshot of the OS answer
  // (see cookieModeToPersist), and letting it reach providerDefault pulled
  // next-themes out of "system" mode forever after the very first write --
  // the device-follow setting then worked exactly once per browser, because
  // the user never clicked anything and localStorage stayed empty. The
  // cookie still wins for `serverMode` (it is the freshest known answer, and
  // the server has no other way to learn the OS preference), but
  // providerDefault must stay "system" for `follow` no matter what the
  // cookie says, so next-themes keeps tracking the device.
  it("keeps providerDefault at system for follow even once the OS answer is cookied", () => {
    expect(resolveThemeMode("dark", "follow")).toEqual({ serverMode: "dark", providerDefault: "system" });
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

describe("readCookieValue", () => {
  it("finds the named cookie among several", () => {
    expect(readCookieValue("sidebar_collapsed=true; bis-theme=dark", "bis-theme")).toBe("dark");
  });

  it("finds a single cookie with no siblings", () => {
    expect(readCookieValue("bis-theme=light", "bis-theme")).toBe("light");
  });

  it("returns undefined when the cookie is absent", () => {
    expect(readCookieValue("sidebar_collapsed=true", "bis-theme")).toBeUndefined();
    expect(readCookieValue("", "bis-theme")).toBeUndefined();
  });

  it("trims surrounding whitespace and decodes the value", () => {
    expect(readCookieValue("a=1;  bis-theme=dark  ; b=2", "bis-theme")).toBe("dark");
    expect(readCookieValue("bis-theme=dark%3Bposition%3Afixed", "bis-theme")).toBe("dark;position:fixed");
  });
});

// Fix 3: before ThemeCookieSync existed, the toggle only ever called
// setTheme -- no cookie -- and enableSystem was off. Every existing
// dark-mode user therefore has `localStorage.theme = "dark"` and no
// `bis-theme` cookie today; without this migration the server would paint
// light forever while next-themes puts `.dark` on <html> from localStorage,
// a permanent mismatch on any themed tenant.
describe("cookieModeToMigrate", () => {
  it("migrates an explicit stored choice when there is no cookie yet", () => {
    expect(cookieModeToMigrate(undefined, "dark")).toBe("dark");
    expect(cookieModeToMigrate(undefined, "light")).toBe("light");
  });

  // The guard. Once a cookie exists -- written by this migration, the toggle,
  // or ThemeCookieSync's follow-mode branch -- it must never re-fire, or a
  // stale localStorage value could overwrite a deliberate later choice.
  it("does nothing once a cookie already exists, no matter what localStorage holds", () => {
    expect(cookieModeToMigrate("light", "dark")).toBeNull();
    expect(cookieModeToMigrate("dark", "dark")).toBeNull();
  });

  it("does nothing for a missing or unusable stored value", () => {
    expect(cookieModeToMigrate(undefined, null)).toBeNull();
    expect(cookieModeToMigrate(undefined, "system")).toBeNull();
  });
});
