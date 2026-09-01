import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globals = readFileSync(
  join(__dirname, "../../app/(dashboard)/globals.css"), "utf-8");

const tokens = readFileSync(
  join(__dirname, "../../styles/tokens.css"), "utf-8");

describe("design foundation: fonts", () => {
  it("exposes --font-display mapped to the Bricolage variable", () => {
    expect(globals).toMatch(/--font-display:\s*var\(--font-bricolage\)/);
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
    expect(tokens).toMatch(/\.dark\s*\{[^}]*--surface-0:\s*#0E0D14/i);
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
