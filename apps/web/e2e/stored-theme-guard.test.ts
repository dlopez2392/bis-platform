import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A spec that CLICKS the topbar theme toggle saves a real choice to
 * `users.theme` on a shared per-run identity, and a saved theme outranks the
 * tenant's brand_mode and the role default (DESIGN.md, Identity). Left behind,
 * it repaints every later spec that signs in as that identity.
 *
 * It has bitten twice. CI e2e on 2c0e6fb0 (theme.spec, tenant-theme.spec; see
 * stored-theme.ts). Then CI e2e on 69d55e94 (feat/m7a-pr4-pause):
 * billing-pause.spec.ts's read-only test clicked the toggle as the client
 * fixture's Owner and never put it back, so client-access.spec.ts, which runs
 * after it, painted that brand_mode "dark" tenant LIGHT and its primary button
 * read `linear-gradient(rgb(30, 58, 138), rgb(19, 43, 112))` instead of the
 * dark gradient it pins.
 *
 * The rule this pins: a spec that clicks the toggle also resets the saved
 * theme through stored-theme.ts (`clearStoredTheme` or `restoreStoredTheme`)
 * in real code. Comments are stripped first, so a sentence that merely NAMES
 * the helper cannot satisfy it.
 */

const E2E_DIR = join(__dirname);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const CLICKS_TOGGLE = /getByTestId\(\s*["']theme-toggle["']\s*\)\s*\.click\(/;
const RESETS_THEME = /\b(?:clearStoredTheme|restoreStoredTheme)\s*\(/;

export function togglesWithoutReset(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, src]) => {
      const code = stripComments(src);
      return CLICKS_TOGGLE.test(code) && !RESETS_THEME.test(code);
    })
    .map(([name]) => name)
    .sort();
}

describe("specs that click the theme toggle reset the saved theme", () => {
  it("flags a toggle click with no reset, and a reset that exists only in a comment (positive control)", () => {
    const clicks = `await page.getByTestId("theme-toggle").click();`;
    expect(togglesWithoutReset({ "a.spec.ts": clicks })).toEqual(["a.spec.ts"]);
    expect(togglesWithoutReset({ "b.spec.ts": `${clicks}\n// clearStoredTheme(id) in afterAll` })).toEqual(["b.spec.ts"]);
    expect(togglesWithoutReset({ "c.spec.ts": `${clicks}\nawait clearStoredTheme(id);` })).toEqual([]);
    expect(togglesWithoutReset({ "d.spec.ts": `${clicks}\nawait restoreStoredTheme(id, before);` })).toEqual([]);
    // Only asserting the toggle is ABSENT is not a click (signed-out.spec).
    expect(togglesWithoutReset({ "e.spec.ts": `await expect(page.getByTestId("theme-toggle")).toHaveCount(0);` })).toEqual([]);
  });

  it("every e2e spec in this directory that clicks the toggle resets users.theme (mutation: drop billing-pause.spec.ts's restoreStoredTheme → FAILS naming it)", () => {
    const files: Record<string, string> = {};
    for (const name of readdirSync(E2E_DIR).filter((f) => f.endsWith(".spec.ts"))) {
      files[name] = readFileSync(join(E2E_DIR, name), "utf-8");
    }
    // The scan must actually see the specs that click the toggle, or an empty
    // directory read would pass it.
    const clickers = Object.entries(files).filter(([, s]) => CLICKS_TOGGLE.test(stripComments(s))).map(([n]) => n);
    expect(clickers).toEqual(expect.arrayContaining(["billing-pause.spec.ts", "tenant-theme.spec.ts", "theme.spec.ts"]));
    expect(togglesWithoutReset(files)).toEqual([]);
  });
});
