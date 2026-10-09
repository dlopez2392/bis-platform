import { describe, it, expect, vi, beforeEach } from "vitest";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";
import { toggleTheme } from "./theme-toggle";

/**
 * D-074: the command palette's "Toggle theme" action called `setTheme`
 * alone, skipping both the cookie write and the `router.refresh()` the
 * topbar's own ThemeToggle button performs (theme-toggle.tsx's own doc
 * comment on the refresh: a themed tenant's inline-style token block
 * overrides BOTH mode blocks, so the class flip alone leaves a themed
 * client's dashboard under the wrong mode's colours until the next
 * navigation). `toggleTheme` is the one function both now share — this is
 * a real behavioural test, not a source pin: unlike app-sidebar.tsx and
 * command-palette.tsx (hook-heavy client components with no render test in
 * this repo), this function takes its DOM dependency as `document.cookie`
 * alone and its side effects as plain injected callbacks, so a stubbed
 * `document` and two `vi.fn()`s exercise the real code path.
 */
describe("toggleTheme", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { cookie: "" });
  });

  it("flips dark to light: writes the bis-theme cookie, calls setTheme, and refreshes (mutation: drop the cookie write or the refresh → FAILS)", () => {
    const setTheme = vi.fn();
    const refresh = vi.fn();

    toggleTheme("dark", setTheme, refresh);

    expect(document.cookie).toBe(`${THEME_COOKIE}=light; path=/; max-age=31536000; samesite=lax`);
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("light");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("flips light (or next-themes' resolvedTheme being anything but 'dark') to dark", () => {
    const setTheme = vi.fn();
    const refresh = vi.fn();

    toggleTheme("light", setTheme, refresh);

    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // Review round: this test's NAME used to claim the cookie is written
  // before the refresh — true of the real code, but the body only ever
  // tracked `setTheme`/`refresh`, never the cookie write itself, so it
  // could not have caught that ordering breaking. The cookie write is
  // folded into the SAME `calls` array here (a setter on the stubbed
  // `document`), so the full order — cookie, then setTheme, then refresh —
  // is what the assertion actually checks.
  it("writes the cookie, THEN calls setTheme, THEN refresh — the server's next request must see the choice before the class flips or the page is asked to repaint", () => {
    const calls: string[] = [];
    let cookieValue = "";
    vi.stubGlobal("document", {
      get cookie() { return cookieValue; },
      set cookie(v: string) { cookieValue = v; calls.push("cookie"); },
    });
    const setTheme = vi.fn(() => calls.push("setTheme"));
    const refresh = vi.fn(() => calls.push("refresh"));

    toggleTheme("dark", setTheme, refresh);

    expect(calls).toEqual(["cookie", "setTheme", "refresh"]);
  });
});
