import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Code only: line/block comments (and so JSX comments) removed, string and
 * template contents kept. Same scanner as app-sidebar.test.ts and
 * manage-billing-button.test.ts: this component has no render test (cmdk,
 * `usePathname`, `useRouter`, `useTheme`, `useSyncExternalStore` would all
 * need mocking for no payoff — D-074's bug, which function `runEntry` calls,
 * is exactly what a source pin can see).
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

const src = stripComments(readFileSync(path.join(here, "command-palette.tsx"), "utf8"));

describe("CommandPalette — 'Toggle theme' shares theme-toggle.tsx's toggleTheme (D-074)", () => {
  it("imports the shared function", () => {
    expect(src).toMatch(/import\s*\{\s*toggleTheme\s*\}\s*from\s*"@\/components\/theme-toggle"/);
  });

  it("runEntry's action branch calls it with the cookie-write-and-refresh behaviour, never a bare setTheme call (mutation: revert to `setTheme(resolvedTheme === \"dark\" ? \"light\" : \"dark\")` → FAILS)", () => {
    expect(src).toContain("toggleTheme(resolvedTheme, setTheme, () => router.refresh());");
    expect(src).not.toMatch(/setTheme\(resolvedTheme === "dark" \? "light" : "dark"\)/);
  });
});
