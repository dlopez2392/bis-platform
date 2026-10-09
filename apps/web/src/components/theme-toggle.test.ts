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

  it("calls setTheme and refresh in that order — the cookie must be written before the refreshed request can read it, but setTheme before refresh is what repaints the class synchronously first", () => {
    const calls: string[] = [];
    const setTheme = vi.fn(() => calls.push("setTheme"));
    const refresh = vi.fn(() => calls.push("refresh"));

    toggleTheme("dark", setTheme, refresh);

    expect(calls).toEqual(["setTheme", "refresh"]);
  });
});
