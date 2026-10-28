// apps/web/src/components/ui/sonner-style.test.ts
//
// Found 2026-10-28 by a built-app design check: the Undo toast painted
// Sonner's `richColors` (library greens and reds), Sonner's system-font
// stack and a 4px action button — none of it from tokens.css. Sonner injects
// its stylesheet UN-layered at runtime, so a Tailwind utility can never beat
// its styled-mode rules; the fix is `unstyled` plus token classes, and these
// tests pin that configuration as data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOAST_OPTIONS, TOAST_ICONS } from "./sonner";

const here = path.dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(path.join(here, "../../app/(dashboard)/layout.tsx"), "utf8");

const cls = (name: keyof NonNullable<typeof TOAST_OPTIONS.classNames>) => {
  const v = TOAST_OPTIONS.classNames?.[name];
  expect(v, `classNames.${String(name)} missing`).toBeTypeOf("string");
  return ` ${v} `;
};
const has = (list: string, token: string) => list.includes(` ${token} `);

describe("toasts are drawn from the design tokens (2026-10-28)", () => {
  it("the dashboard's Toaster no longer asks for Sonner's richColors", () => {
    expect(layout).toMatch(/<Toaster\b/);
    expect(layout).not.toMatch(/richColors/);
  });

  it("Sonner's own styled mode is off, so its un-layered rules cannot outrank the tokens", () => {
    expect(TOAST_OPTIONS.unstyled).toBe(true);
  });

  it("the toast is an overlay card: glass-overlay, --line-strong edge, 12px card radius, Geist", () => {
    const t = cls("toast");
    for (const token of ["glass-overlay", "border", "border-[var(--line-strong)]", "rounded-[var(--radius-card)]", "font-sans"]) {
      expect(has(t, token), token).toBe(true);
    }
  });

  it("the action (Undo) button is an 8px control in the primary text colour, ghost on hover", () => {
    const a = cls("actionButton");
    for (const token of ["rounded-[var(--radius-ctl)]", "text-primary", "hover:bg-[var(--surface-3)]"]) {
      expect(has(a, token), token).toBe(true);
    }
  });

  it("the description reads --text-2 even over Sonner's dark-theme #e8e8e8 rule", () => {
    expect(has(cls("description"), "text-[var(--text-2)]!")).toBe(true);
  });

  it("status tints only the icon, from the status tokens — the message stays the word", () => {
    expect(has(cls("success"), "[&_[data-icon]]:text-[var(--good)]")).toBe(true);
    expect(has(cls("error"), "[&_[data-icon]]:text-[var(--crit)]")).toBe(true);
    expect(has(cls("warning"), "[&_[data-icon]]:text-[var(--warn)]")).toBe(true);
  });

  it("success and error differ in SHAPE, not colour alone (rule 3)", () => {
    expect(TOAST_ICONS.success.type).not.toBe(TOAST_ICONS.error.type);
    expect(TOAST_ICONS.warning.type).not.toBe(TOAST_ICONS.error.type);
  });

  it("no class names a literal colour", () => {
    const all = Object.values(TOAST_OPTIONS.classNames ?? {}).join(" ");
    expect(all).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsl\(|(?:bg|text|border)-(?:green|red|emerald|rose|gray|zinc|neutral)-/i);
  });
});
