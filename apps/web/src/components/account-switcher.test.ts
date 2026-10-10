import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Source-only, same convention as app-sidebar.test.ts (which this component
 * is rendered from): a render test would need Popover/Command's own
 * portal-based internals and `usePathname`/`useRouter` mocked for no
 * behavioural payoff a class-string assertion doesn't already cover, and
 * the F-107 defect this pins is in which CLASSES an element carries, not in
 * anything a DOM query would see differently from reading the source.
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

const src = stripComments(readFileSync(path.join(here, "account-switcher.tsx"), "utf8"));

// F-107 (rider part): below Tailwind's `sm` breakpoint the switcher is
// always the icon-only chip, whatever `collapsed` says — same reasoning as
// app-sidebar.tsx's own SidebarLink/SetupMeterLink (app-sidebar.test.ts).
describe("AccountSwitcher — F-107 (rider part): below `sm` the trigger is icon-only regardless of `collapsed`", () => {
  it("the trigger's own base classes are the collapsed look (justify-center, px-0), unconditionally (mutation: drop `justify-center` or `px-0` from the base string → FAILS)", () => {
    expect(src).toMatch(
      /"flex w-full items-center justify-center gap-2 rounded-\[var\(--radius-ctl\)\] border border-sidebar-border px-0 py-2/,
    );
  });

  it("only `!collapsed` restores the expanded spacing, and only at sm+ (mutation: drop `!collapsed &&` so it always applies, or drop `sm:` so it applies below `sm` too → FAILS)", () => {
    expect(src).toMatch(/!collapsed && "sm:justify-start sm:px-2"/);
  });

  it("the name/timezone text block is hidden below `sm` even when expanded (mutation: drop `hidden`/`sm:block` → FAILS)", () => {
    expect(src).toContain('<span className="hidden min-w-0 flex-1 sm:block">');
  });

  it("the chevron is hidden below `sm` even when expanded (mutation: drop `hidden`/`sm:block` → FAILS)", () => {
    expect(src).toContain('<ChevronsUpDown className="hidden size-4 shrink-0 opacity-60 sm:block" aria-hidden />');
  });
});
