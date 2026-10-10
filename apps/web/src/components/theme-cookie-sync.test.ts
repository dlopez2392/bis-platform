import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source pin (no render harness in this repo): the effect's decision is
 * nextThemeSync, tested in theme-mode.test.ts through both reviewer
 * sequences; this pins that the component actually feeds it the ref it
 * keeps, rather than calling userThemeSyncPlan on every run (Task 6 fix
 * round 1, I1). Comment lines are dropped first so a commented-out call
 * cannot satisfy the pin.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "theme-cookie-sync.tsx"), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("ThemeCookieSync", () => {
  it("decides through nextThemeSync with its last-applied ref, and records the new value (mutation: call userThemeSyncPlan(userTheme, theme, existing) directly -> FAILS)", () => {
    expect(src).toMatch(/const lastApplied = useRef<[^>]+>\(undefined\)/);
    expect(src).toMatch(/nextThemeSync\(lastApplied\.current, userTheme, theme, existing\)/);
    expect(src).toMatch(/lastApplied\.current = sync\.lastApplied/);
    expect(src).not.toMatch(/userThemeSyncPlan\(/);
  });
});
