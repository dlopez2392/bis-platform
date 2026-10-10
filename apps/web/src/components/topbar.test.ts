import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Source-only, same convention as app-sidebar.test.ts: Topbar is a server
 * component that renders Clerk's OrganizationSwitcher/UserButton and the
 * client-only CommandPalette/ThemeToggle/TopbarPresence — a render test
 * would need all four mocked for no behavioural payoff a class-string
 * assertion doesn't already cover, and the F-107 defect this pins (a
 * fixed-width box that cannot shrink) is in which CLASSES the wrapper
 * carries, not in anything a DOM query would see differently.
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

const src = stripComments(readFileSync(path.join(here, "topbar.tsx"), "utf8"));

// F-107 (rider part): the ⌘K trigger's wrapper is a fixed 300px box around a
// Button that is itself `shrink-0 whitespace-nowrap` (components/ui/button.tsx)
// — a narrower box would not shrink that button, it would overflow the
// topbar instead. At 375/320px wide, with the sidebar's own 64px taken first,
// 300px alone is already more than what's left, so this is hidden below `sm`
// rather than resized.
describe("Topbar — F-107 (rider part): the search trigger is hidden below `sm`, not resized", () => {
  it("the palette wrapper is hidden by default and only flex at sm+ (mutation: drop `hidden`/`sm:flex` → FAILS)", () => {
    expect(src).toContain('<div className="mr-auto hidden w-[300px] min-w-0 items-center sm:flex">{palette}</div>');
  });
});
