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
  it("exposes --font-display mapped to the Bricolage variable", () => {
    expect(globals).toMatch(/--font-display:\s*var\(--font-bricolage\)/);
  });

  it("tokens.css repoints --font-display to var(--font-bricolage) in BOTH blocks (light :root and .dark) — a bare literal stack here would resolve to the browser/system face, not next/font's optimized one", () => {
    const matches = [...tokens.matchAll(/--font-display:\s*var\(--font-bricolage\)/g)];
    expect(matches.length).toBe(2);
  });

  it("Bricolage preloads now that page-header.tsx consumes --font-display", () => {
    // Scoped to the bricolage object literal ([^}]* stops at its closing
    // brace) so this cannot false-match the unrelated "next/font/google
    // defaults to `preload: true`" prose in a later comment.
    expect(dashboardLayout).toMatch(
      /const bricolage = Bricolage_Grotesque\(\{[^}]*preload:\s*true[^}]*\}\)/
    );
  });

  it("layout.tsx's Bricolage comment no longer claims no consumer exists", () => {
    expect(dashboardLayout).not.toMatch(/Preload off until P2\/P3/);
    expect(dashboardLayout).not.toMatch(/flip back when --font-display enters the UI/);
  });
});

describe("design foundation: tokens scaffolding", () => {
  it("uses the app's :root(light)/.dark polarity, not data-theme", () => {
    expect(tokens).not.toMatch(/data-theme/);
    expect(tokens).toMatch(/\.dark\s*\{/);
  });
  it("light default: :root carries the light surface ladder", () => {
    expect(tokens).toMatch(/:root\s*\{[^}]*--surface-0:\s*#F6F5FA/i);
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
