import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globals = readFileSync(
  join(__dirname, "../../app/(dashboard)/globals.css"), "utf-8");

const tokens = readFileSync(
  join(__dirname, "../../styles/tokens.css"), "utf-8");

const dashboardLayout = readFileSync(
  join(__dirname, "../../app/(dashboard)/layout.tsx"), "utf-8");

describe("design foundation: fonts", () => {
  // The DISPLAY ROLE is the UI face at weight 600, not Bricolage: the mockup
  // loads Bricolage for its own page chrome but .dir-a — the direction the app
  // ships — overrides it (northern-lights.html:157, `--f-disp: "Geist";
  // --disp-w: 600`). Decided 2026-09-09; the mockup is the source.
  it("exposes --font-display mapped to the Geist variable (the mockup's .dir-a --f-disp)", () => {
    expect(globals).toMatch(/--font-display:\s*var\(--font-geist-sans\)/);
    expect(globals).not.toMatch(/--font-display:\s*var\(--font-bricolage\)/);
  });

  it("tokens.css repoints --font-display to var(--font-geist-sans) in BOTH blocks (light :root and .dark) — a bare literal stack here would resolve to the browser/system face, not next/font's optimized one", () => {
    const matches = [...tokens.matchAll(/--font-display:\s*var\(--font-geist-sans\)/g)];
    expect(matches.length).toBe(2);
    expect(tokens).not.toMatch(/--font-bricolage/);
  });

  it("Bricolage no longer preloads — nothing consumes --font-bricolage since the display role became Geist 600", () => {
    // Scoped to the bricolage object literal ([^}]* stops at its closing
    // brace) so this cannot false-match the unrelated "next/font/google
    // defaults to `preload: true`" prose in a later comment.
    expect(dashboardLayout).toMatch(
      /const bricolage = Bricolage_Grotesque\(\{[^}]*preload:\s*false[^}]*\}\)/
    );
  });
});

describe("design foundation: tokens scaffolding", () => {
  it("uses the app's :root(light)/.dark polarity, not data-theme", () => {
    expect(tokens).not.toMatch(/data-theme/);
    expect(tokens).toMatch(/\.dark\s*\{/);
  });
  it("light default: :root carries the light surface ladder", () => {
    expect(tokens).toMatch(/:root\s*\{[^}]*--surface-0:\s*#EFEBF9/i);
  });
  it("dark values live under .dark", () => {
    expect(tokens).toMatch(/\.dark\s*\{[^}]*--surface-0:\s*#0B0A12/i);
  });
  it("carries no base element rules — globals owns those", () => {
    expect(tokens).not.toMatch(/^\s*body\s*\{/m);
    expect(tokens).not.toMatch(/prefers-reduced-motion/);
    expect(tokens).not.toMatch(/:focus-visible/);
  });
  it("renamed the glow token — no bare --ring collision with globals", () => {
    expect(tokens).toMatch(/--ring-glow:/);
    expect(tokens).not.toMatch(/--ring:\s/);
  });
});

describe("design foundation: base rules", () => {
  it("globals owns the focus ring and the reduced-motion kill switch", () => {
    expect(globals).toMatch(/:focus-visible/);
    expect(globals).toMatch(/prefers-reduced-motion/);
  });
});
