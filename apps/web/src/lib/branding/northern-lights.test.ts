// apps/web/src/lib/branding/northern-lights.test.ts
//
// File-reading parity for the Northern Lights material (spec §3). Same shape
// as design-foundation.test.ts: the CSS is data, so the test reads it and pins
// the values the mockup (docs/design/northern-lights.html, .dir-a block) fixed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_STYLE_FALLBACKS } from "./theme-style";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(path.join(here, "../../styles/tokens.css"), "utf8");
const globals = readFileSync(path.join(here, "../../app/(dashboard)/globals.css"), "utf8");

const rootBlock = tokens.match(/:root\s*\{([^}]*)\}/)![1]!;
const darkBlock = tokens.match(/\.dark\s*\{([^}]*)\}/)![1]!;
const value = (block: string, token: string) =>
  block.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim();

describe("tokens.css — Northern Lights (spec §3)", () => {
  it.each([
    ["surface-0", "#0B0A12"], ["surface-1", "rgba(255,255,255,.035)"],
    ["surface-2", "rgba(255,255,255,.06)"], ["surface-3", "rgba(255,255,255,.09)"],
    ["line", "rgba(255,255,255,.08)"], ["line-strong", "rgba(255,255,255,.14)"],
    ["text-1", "#F1EEFA"], ["text-2", "#9A94B4"], ["text-3", "#7B7593"],
    ["glow-1-alpha", ".28"], ["glow-2-alpha", ".16"], ["glow-3-alpha", ".12"], ["grid-alpha", ".025"],
    ["glass-filter", "blur(14px)"], ["glass-highlight", "inset 0 1px 0 rgba(255,255,255,.06)"],
    ["sheen", "linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%)"],
    ["surface-overlay", "rgba(22,20,34,.88)"],
    ["shadow-card", "var(--glass-highlight), 0 20px 50px -30px rgba(0,0,0,.8)"],
    ["shadow-overlay", "var(--glass-highlight), 0 16px 40px -16px rgba(0,0,0,.9)"],
    ["accent-2", "#4FD8E6"], ["accent-2-dim", "rgba(79, 216, 230, .14)"], ["ring-glow-2", "rgba(79, 216, 230, .35)"],
  ])("dark --%s is %s", (token, expected) => {
    expect(value(darkBlock, token)).toBe(expected);
  });

  // Sidebar chrome: dark in BOTH themes (recorded decision) — identical values in both blocks.
  // Exception: --sidebar-ground is #0B0A12 in :root but transparent in .dark (orchestrator decision
  // post-dating the spec, so the page glow shows through in dark mode).
  it.each([
    ["sidebar-surface", "rgba(255,255,255,.02)"], ["sidebar-line", "rgba(255,255,255,.07)"],
    ["sidebar-text", "#B9B3CF"], ["sidebar-text-strong", "#FFFFFF"], ["sidebar-tint", "#8B7CF7"], ["sidebar-tint-2", "#4FD8E6"],
  ])("--%s is %s in :root AND .dark", (token, expected) => {
    expect(value(rootBlock, token)).toBe(expected);
    expect(value(darkBlock, token)).toBe(expected);
  });

  // --sidebar-ground is the exception: dark sidebar in light mode, transparent in dark so glow shows through.
  it("--sidebar-ground is #0B0A12 in :root (light keeps dark chrome) and transparent in .dark (page glow shows through)", () => {
    expect(value(rootBlock, "sidebar-ground")).toBe("#0B0A12");
    expect(value(darkBlock, "sidebar-ground")).toBe("transparent");
  });

  it.each([
    ["surface-0", "#F6F5FA"], ["surface-1", "#FFFFFF"], ["surface-2", "#FFFFFF"], ["surface-3", "#F1EFF7"],
    ["glow-1-alpha", ".07"], ["glow-2-alpha", ".05"], ["glow-3-alpha", ".04"], ["grid-alpha", ".012"],
    ["glass-filter", "none"], ["glass-highlight", "inset 0 1px 0 rgba(255,255,255,.9)"], ["sheen", "none"],
    ["surface-overlay", "rgba(255,255,255,.96)"],
    ["shadow-card", "0 1px 2px rgba(29,25,48,.05), 0 12px 32px -18px rgba(29,25,48,.22)"],
    ["shadow-overlay", "var(--glass-highlight), 0 12px 32px -18px rgba(29,25,48,.22)"],
    ["accent-2", "#0891B2"], ["accent-2-dim", "rgba(8, 145, 178, .14)"], ["ring-glow-2", "rgba(8, 145, 178, .28)"],
  ])("light --%s is %s", (token, expected) => {
    expect(value(rootBlock, token)).toBe(expected);
  });

  it("swaps the dark glass steps to opaque composites when backdrop-filter is unsupported", () => {
    const fallback = tokens.match(/@supports not \(backdrop-filter: blur\(1px\)\)\s*\{\s*\.dark\s*\{([^}]*)\}/)?.[1];
    expect(fallback).toBeTruthy();
    expect(value(fallback!, "surface-1")).toBe("#15131F");
    expect(value(fallback!, "surface-2")).toBe("#1B1826");
    expect(value(fallback!, "surface-3")).toBe("#211D2E");
    // Dialog and sheet were fully opaque before the glass pass; with no blur
    // to separate them, 88% alpha would leak the page behind.
    expect(value(fallback!, "surface-overlay")).toBe("#1B1826");
  });

  it("keeps the fallback AFTER the main .dark block, so theme.test.ts's first-match regex still reads the live values", () => {
    expect(tokens.indexOf("@supports not")).toBeGreaterThan(tokens.indexOf(".dark {"));
  });

  it("keeps SAFE_STYLE_FALLBACKS.color equal to the light --surface-0", () => {
    expect(SAFE_STYLE_FALLBACKS.color).toBe(value(rootBlock, "surface-0")!.toLowerCase());
  });
});

// The three tokens COMPOSED from the accent family (`--gradient-hero`,
// `--gradient-primary`, `--shadow-glow`) are declared on `*`, not on
// `:root`/`.dark`. A custom property whose value contains var() is substituted
// on the element that DECLARES it, so on :root each one resolves once against
// BIS's own accent and inherits down as a frozen string — the tenant accent
// family themeStyle paints on <body> could never reach btn-primary, hero-text
// or the button glow, and a branded dashboard showed BIS violet (spec §6).
// These are the SAME six formulas the :root/.dark tables above used to pin,
// per mode; only the selector they hang on moved.
describe("composed accent tokens re-resolve on every element", () => {
  // The `*` is escaped and both blocks are anchored to a line start, so the
  // `*` that opens or closes a /* … */ comment can never be read as the
  // universal selector. Empty-string fallbacks rather than `!`: deleting a
  // block must fail the value pins below by NAME, not explode collection.
  const starBlock = tokens.match(/(?:^|\n)\*\s*\{([^}]*)\}/)?.[1] ?? "";
  const darkStarBlock = tokens.match(/(?:^|\n)\.dark\s+\*\s*\{([^}]*)\}/)?.[1] ?? "";

  it("declares a * block and a .dark * block", () => {
    expect(starBlock).not.toBe("");
    expect(darkStarBlock).not.toBe("");
  });

  it.each([
    ["gradient-hero", "linear-gradient(90deg, var(--accent), var(--accent-2))"],
    ["gradient-primary", "linear-gradient(180deg, var(--accent), var(--accent-strong))"],
    ["shadow-glow", "0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 35%, transparent)"],
  ])("light * --%s is %s", (token, expected) => {
    expect(value(starBlock, token)).toBe(expected);
  });

  it.each([
    ["gradient-hero", "linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, white), color-mix(in srgb, var(--accent-2) 60%, white))"],
    ["gradient-primary", "linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, white), var(--accent))"],
    ["shadow-glow", "0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent)"],
  ])("dark .dark * --%s is %s", (token, expected) => {
    expect(value(darkStarBlock, token)).toBe(expected);
  });

  // The guard, and the whole point of the move: a declaration left behind on
  // :root or .dark wins nothing on `*`'s own elements, but it DOES resolve on
  // the root element itself and re-freezes BIS violet into everything that
  // inherits from there before `*` ever re-declares it — the exact defect.
  it.each(["gradient-hero", "gradient-primary", "shadow-glow"])(
    "does NOT declare --%s on :root or .dark, where it would freeze the BIS accent into an inherited string",
    (token) => {
      expect(value(rootBlock, token)).toBeUndefined();
      expect(value(darkBlock, token)).toBeUndefined();
    });
});

describe("globals.css — semantic mapping (spec §3.2, §4)", () => {
  const gRoot = globals.match(/:root\s*\{([^}]*)\}/)![1]!;
  const gDark = globals.match(/\.dark\s*\{([^}]*)\}/)![1]!;

  it("floats every overlay on --surface-overlay through --popover", () => {
    expect(gRoot).toMatch(/--popover:\s*var\(--surface-overlay\);/);
  });

  it("routes the sidebar semantic vars to the chrome tokens (no literal island, dark in both themes)", () => {
    expect(gRoot).toMatch(/--sidebar:\s*var\(--sidebar-surface\);/);
    expect(gRoot).toMatch(/--sidebar-foreground:\s*var\(--sidebar-text\);/);
    expect(gRoot).toMatch(/--sidebar-accent:\s*var\(--sidebar-tint\);/);
    expect(gRoot).toMatch(/--sidebar-border:\s*var\(--sidebar-line\);/);
    expect(gDark).not.toMatch(/--sidebar/);
  });

  it("sidebar-chrome paints the chrome ground under the (tenant-overridable) --sidebar layer, with blur", () => {
    const body = globals.match(/@utility sidebar-chrome\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-color:\s*var\(--sidebar-ground\);/);
    expect(body).toMatch(/background-image:\s*linear-gradient\(var\(--sidebar\), var\(--sidebar\)\);/);
    // Unprefixed only — Lightning CSS folds a hand-written -webkit- twin into
    // the prefixed form and drops the standard property, and Chromium does
    // not alias it, so a -webkit- line here silently ships zero blur.
    expect(body).toMatch(/(^|[^-])backdrop-filter:\s*var\(--glass-filter\);/);
    expect(body).not.toMatch(/-webkit-backdrop-filter/);
  });

  it("glass-overlay = popover surface + shadow-overlay + var(--glass-filter), unprefixed only", () => {
    const body = globals.match(/@utility glass-overlay\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-color:\s*var\(--popover\);/);
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-overlay\);/);
    // Unprefixed only — see the sidebar-chrome test above for why.
    expect(body).toMatch(/(^|[^-])backdrop-filter:\s*var\(--glass-filter\);/);
    expect(body).not.toMatch(/-webkit-backdrop-filter/);
  });

  it.each(["glass", "glass-overlay", "sidebar-chrome", "btn-primary", "pill-on", "hero-text", "bar-accent", "bar-hot"])(
    "defines the %s utility", (name) => {
      expect(globals).toMatch(new RegExp(`@utility ${name}\\s*\\{`));
    });

  it("glass = sheen + shadow-card + var(--glass-filter), never a background colour (tenant --card must win)", () => {
    const body = globals.match(/@utility glass\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-image:\s*var\(--sheen\);/);
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-card\);/);
    // Unprefixed only — see the sidebar-chrome test above for why.
    expect(body).toMatch(/(^|[^-])backdrop-filter:\s*var\(--glass-filter\);/);
    expect(body).not.toMatch(/-webkit-backdrop-filter/);
    expect(body).not.toMatch(/background-color/);
  });

  it("hero-text clips --gradient-hero to text", () => {
    const body = globals.match(/@utility hero-text\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-image:\s*var\(--gradient-hero\);/);
    expect(body).toMatch(/background-clip:\s*text;/);
  });

  it("carries no hex literal outside the sanctioned islands (--primary-foreground, --stage-1..6)", () => {
    const stripped = globals
      .replace(/--primary-foreground:\s*#[0-9a-fA-F]{6};/g, "")
      .replace(/--stage-[1-6]:\s*#[0-9a-fA-F]{6};/g, "");
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
