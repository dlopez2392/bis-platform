import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Code only: line/block comments (and so JSX comments) removed, string and
 * template contents kept. Same scanner as manage-billing-button.test.ts
 * (copied from lib/history-state.test.ts): a source pin satisfied by a
 * commented-out line proved nothing (review of cd495636).
 *
 * This component has no render test at all — `usePathname()`, the
 * `useShellData()` context and `AccountSwitcher` would all need mocking for
 * no behavioural payoff here, and D-072's bug is in which VALUE a line
 * reads, not in anything a DOM assertion would see differently. A source
 * pin is the same convention this repo already reaches for when a client
 * component's interesting line runs ahead of any click (D-056/D-057's
 * link-site-card.test.ts, and manage-billing-button.test.ts before it).
 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

const src = stripComments(readFileSync(path.join(here, "app-sidebar.tsx"), "utf8"));

// D-072: the sidebar's own identity-block label fell back from the brand
// name to `clientAccountName` — the agency's private internal label,
// passed straight from `clientState.name` (accounts.name) by
// dashboard/layout.tsx. Pins that the fallback, and the prop that only
// ever carried it, are gone — not just renamed or reordered.
describe("AppSidebar — the client identity label never falls back to the agency's private account name (D-072)", () => {
  it("computes clientLabel from the brand name alone, in CODE (mutation: restore `?? clientAccountName` → FAILS)", () => {
    expect(src).toMatch(/const clientLabel = clientBrandName;/);
  });

  it("no longer accepts a clientAccountName prop at all — the ONLY thing it ever carried was this leak", () => {
    expect(src).not.toContain("clientAccountName");
  });
});

// F-107 (rider part, docs/crm-features.md §4.3's `| 5 | F-107 (part) |` row):
// below Tailwind's `sm` breakpoint (640px — narrower than either width the
// rider names, 375 and 320) the sidebar is ALWAYS the 64px icon-only rail,
// whatever the `collapsed` cookie/toggle state says — there is no overlay to
// expand it into yet (F-107's second part), so content that only rendered in
// the `collapsed === false` branch (labels, the wordmark, the account-
// switcher's name/timezone text, the setup meter's count row) must be hidden
// by CSS at that width instead, since JS has no way to know the viewport
// without a hydration flash. Source pins, in the same style as the block
// above: a render test would need usePathname/useShellData mocked for no
// behavioural payoff a class-string assertion doesn't already cover.
describe("AppSidebar — F-107 (rider part): below `sm` the rail is icon-only regardless of `collapsed`", () => {
  it("the aside's own width keeps w-16 as the unprefixed base even when expanded (mutation: revert to the old `: \"w-[236px]\"` → FAILS)", () => {
    expect(src).toMatch(/collapsed \? "w-16" : "w-16 sm:w-\[236px\]"/);
  });

  it("the collapse/expand toggle is hidden below `sm` (mutation: drop `sm:inline-flex` from its className → FAILS)", () => {
    expect(src).toContain(
      'className="hidden rounded-[var(--radius-ctl)] p-1.5 text-sidebar-foreground/70 transition-colors '
      + 'hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)] sm:inline-flex"',
    );
  });

  it("the agency wordmark is hidden below `sm` even when expanded (mutation: drop `hidden`/`sm:inline-block` → FAILS)", () => {
    expect(src).toContain(
      'className="hidden px-1 text-sm font-semibold text-[var(--sidebar-text-strong)] sm:inline-block"',
    );
  });

  it("the footer's bottom padding adds --safe-bottom on top of the existing 14px, not in place of it (mutation: revert to plain `py-3.5` → FAILS)", () => {
    expect(src).toContain('"pb-[calc(0.875rem+var(--safe-bottom))]"');
  });

  it("a nav item's label text is hidden below `sm` even when expanded (mutation: drop `hidden`/`sm:block` → FAILS)", () => {
    expect(src).toContain('<span className="hidden min-w-0 flex-1 truncate sm:block">{item.label}</span>');
  });

  it("the unread dot and pill trade places only at sm+, never below it (mutation: drop either `!collapsed && \"sm:hidden\"` or `!collapsed && \"sm:inline-block\"` → one of the two shows at every width)", () => {
    expect(src).toContain('!collapsed && "sm:hidden"');
    expect(src).toContain('!collapsed && "sm:inline-block"');
  });

  it("the setup meter's label/count row is hidden below `sm` (mutation: drop `hidden`/`sm:flex` → FAILS)", () => {
    expect(src).toContain('<span className="hidden items-center justify-between gap-2 sm:flex">');
  });
});
