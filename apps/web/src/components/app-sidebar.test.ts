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
