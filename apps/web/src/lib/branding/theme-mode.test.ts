import { describe, it, expect } from "vitest";
import {
  cookieModeToMigrate,
  cookieModeToPersist,
  readCookieValue,
  resolveThemeMode,
  THEME_COOKIE,
  userThemeSyncPlan,
  nextThemeSync,
  followUpCookie,
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

  // Owner decision, 2026-10-06: operators (agency staff) default to dark;
  // client-role users keep light (the branch above). The agency never has a
  // brand_mode of its own (no theme to emit), so without this third
  // parameter an operator with no stored choice yet would always land on
  // the client-role fallback above instead.
  it("falls back to dark for an operator with no cookie and no tenant mode", () => {
    expect(resolveThemeMode(undefined, null, true)).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  // A person's own stored choice still wins over the operator default --
  // the cookie branch above is checked before isOperator is ever consulted.
  it("still lets an operator's own stored choice win over the operator default", () => {
    expect(resolveThemeMode("light", null, true)).toEqual({ serverMode: "light", providerDefault: "light" });
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

describe("a person's own theme outranks everything (mis preferencias D5)", () => {
  it("light/dark win over the cookie, the brand and the role (mutation: check userTheme after the cookie -> FAILS)", () => {
    expect(resolveThemeMode("dark", "dark", true, "light")).toEqual({ serverMode: "light", providerDefault: "light" });
    expect(resolveThemeMode("light", "follow", false, "dark")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });
  it("system follows the device: provider 'system', server paints the OS snapshot cookie (mutation: providerDefault = cookie -> FAILS)", () => {
    expect(resolveThemeMode("dark", null, false, "system")).toEqual({ serverMode: "dark", providerDefault: "system" });
  });
  it("system with no snapshot yet paints the role default (mutation: always light -> FAILS for the operator)", () => {
    expect(resolveThemeMode(undefined, null, true, "system")).toEqual({ serverMode: "dark", providerDefault: "system" });
    expect(resolveThemeMode(undefined, null, false, "system")).toEqual({ serverMode: "light", providerDefault: "system" });
  });
  it("NULL leaves today's chain untouched (mutation: treat null as 'system' -> FAILS)", () => {
    expect(resolveThemeMode("light", null, true, null)).toEqual({ serverMode: "light", providerDefault: "light" });
    expect(resolveThemeMode(undefined, null, true, null)).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });
});

describe("userThemeSyncPlan", () => {
  it("adopts the stored theme when next-themes disagrees (another device chose it) (mutation: never setTheme -> FAILS)", () => {
    expect(userThemeSyncPlan("light", "dark", "light")).toEqual({ setTheme: "light", writeCookie: null, skipMigration: true, skipPersist: true });
  });
  it("writes the cookie for light/dark when it differs, never for system (mutation: write 'system' into the cookie -> FAILS)", () => {
    expect(userThemeSyncPlan("dark", "dark", "light").writeCookie).toBe("dark");
    expect(userThemeSyncPlan("system", "system", undefined).writeCookie).toBeNull();
  });
  it("does nothing new when there is no stored choice (mutation: skip the migration for everyone -> FAILS)", () => {
    expect(userThemeSyncPlan(null, "dark", undefined)).toEqual({ setTheme: null, writeCookie: null, skipMigration: false, skipPersist: false });
  });
});

// Fix round 1 (Task 6 review, I1): ThemeCookieSync's effect re-runs on every
// LOCAL theme change, while its `userTheme` prop still holds the server's
// OLD value until the save lands. These walk the effect's real decision
// (nextThemeSync, which the component calls with its ref) through the two
// sequences the reviewer reproduced, carrying `lastApplied` between steps
// exactly as the component's ref does.
describe("nextThemeSync — the server value is applied only when it CHANGES", () => {
  it("undo to 'no choice': the local clear is not pushed back to the old stored theme, and NULL leaves the default rule in charge (mutation: ignore lastApplied and run userThemeSyncPlan every time -> FAILS)", () => {
    // Mount: stored "dark", in step.
    let s = nextThemeSync(undefined, "dark", "dark", "dark");
    expect(s.plan).toEqual({ setTheme: null, writeCookie: null, skipMigration: true, skipPersist: true });
    // The panel's Undo: cookie cleared, next-themes on the fallback, prop still "dark".
    s = nextThemeSync(s.lastApplied, "dark", "light", undefined);
    expect(s.plan.setTheme).toBeNull();
    expect(s.plan.writeCookie).toBeNull();
    // The save lands: prop is now NULL. Nothing is forced; the old branch (role default / cookie rule) runs.
    s = nextThemeSync(s.lastApplied, null, "light", undefined);
    expect(s.plan).toEqual({ setTheme: null, writeCookie: null, skipMigration: false, skipPersist: false });
    expect(s.lastApplied).toBeNull();
  });

  it("a normal change does not flick back while the save is in flight (mutation: ignore lastApplied and run userThemeSyncPlan every time -> FAILS)", () => {
    let s = nextThemeSync(undefined, "light", "light", "light");
    // Local change to dark (panel or toggle), prop still the old "light".
    s = nextThemeSync(s.lastApplied, "light", "dark", "dark");
    expect(s.plan.setTheme).toBeNull();
    expect(s.plan.writeCookie).toBeNull();
    // A stored choice still keeps the migration off while waiting.
    expect(s.plan.skipMigration).toBe(true);
    // The save lands: prop "dark", already in step.
    s = nextThemeSync(s.lastApplied, "dark", "dark", "dark");
    expect(s.plan).toEqual({ setTheme: null, writeCookie: null, skipMigration: true, skipPersist: true });
  });

  it("a NEW server value still wins on mount and when another device changes it (mutation: never apply after the first run -> FAILS)", () => {
    expect(nextThemeSync(undefined, "light", "dark", "dark").plan.setTheme).toBe("light");
    const s = nextThemeSync("light", "dark", "light", "light");
    expect(s.plan).toEqual({ setTheme: "dark", writeCookie: "dark", skipMigration: true, skipPersist: true });
    expect(s.lastApplied).toBe("dark");
  });
});

// Final fix wave, I1: "Follow my device" (userTheme 'system') skips ONLY the
// one-time migration. The cookie must still follow the OS snapshot, or a
// branded client's server-painted tokens for one mode sit under next-themes'
// class for the other (spec 5.3).
describe("followUpCookie — 'system' keeps the OS snapshot, only the migration is skipped", () => {
  it("userTheme 'system' records the device's mode when the cookie disagrees (mutation: one shared skip flag for migration and persist -> FAILS)", () => {
    const plan = userThemeSyncPlan("system", "system", "light");
    expect(plan.skipMigration).toBe(true);
    expect(plan.skipPersist).toBe(false);
    expect(followUpCookie(plan, "light", null, "system", "dark")).toBe("dark");
  });
  it("userTheme 'system' skips the localStorage migration but still persists the snapshot (mutation: run the migration while a stored theme exists -> FAILS)", () => {
    const plan = userThemeSyncPlan("system", "system", undefined);
    expect(followUpCookie(plan, undefined, "dark", "system", "light")).toBe("light");
  });
  it("userTheme light/dark skips both: the plan's own cookie write is the whole story (mutation: persist for light/dark -> FAILS)", () => {
    const plan = userThemeSyncPlan("dark", "dark", "dark");
    expect(plan.skipPersist).toBe(true);
    expect(followUpCookie(plan, "dark", "light", "system", "light")).toBeNull();
  });
  it("no stored choice: migration first, then the snapshot, as before (mutation: skip the migration for everyone -> FAILS)", () => {
    const plan = userThemeSyncPlan(null, "dark", undefined);
    expect(followUpCookie(plan, undefined, "dark", "dark", "dark")).toBe("dark");
    expect(followUpCookie(plan, "dark", null, "system", "light")).toBe("light");
    expect(followUpCookie(plan, "light", null, "system", "light")).toBeNull();
  });
  it("a local-only run while 'system' is stored still persists the snapshot (mutation: nextThemeSync's no-change plan skips persist for 'system' -> FAILS)", () => {
    const s = nextThemeSync("system", "system", "system", "light");
    expect(s.plan.skipMigration).toBe(true);
    expect(s.plan.skipPersist).toBe(false);
    expect(followUpCookie(s.plan, "light", null, "system", "dark")).toBe("dark");
  });
});
