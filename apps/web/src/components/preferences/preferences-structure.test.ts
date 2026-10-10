import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-text pins — the house pattern for components this repo has no
 * render harness for (alert-phone-card.test.ts:7-12). The behaviour lives
 * in preference-handlers.ts and preference-options.ts, which are tested
 * directly; these pin the STRUCTURE the spec and DESIGN.md ask for: the
 * deploy marker, the strict read that reaches the error boundary, two
 * independent groups with no form and no primary button, tokens only, and
 * the user-menu entry. Comments are stripped first, so a pin cannot be
 * satisfied by a commented-out line (registry.test.ts's lesson).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const routeDir = path.join(here, "../../app/(dashboard)/dashboard/preferences");

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
const read = (p: string) => stripComments(readFileSync(p, "utf8"));
const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe("the page (server)", () => {
  const src = read(path.join(routeDir, "page.tsx"));

  it("carries the deploy marker on its root (mutation: drop data-prefs-page -> FAILS)", () => {
    expect(src).toContain("data-prefs-page");
  });

  it("reads with the STRICT loader, so a failed read reaches error.tsx instead of painting defaults (mutation: use getPersonPrefs -> FAILS)", () => {
    expect(src).toMatch(/await Promise\.all\(\[\s*loadMyPreferences\(\),/);
    expect(src).not.toContain("getPersonPrefs");
  });

  it("sends a signed-out caller to sign-in, and takes isAgency from the claim (mutation: drop the redirect -> FAILS)", () => {
    expect(src).toMatch(/if \(!userId\) redirect\("\/sign-in"\)/);
    expect(src).toContain('app_role === "agency_admin"');
  });
});

describe("the panel (client)", () => {
  const src = read(path.join(here, "preferences-panel.tsx"));

  it("is two independent radio groups with no <form> and no Save (mutation: wrap a group in <form> -> FAILS)", () => {
    expect(src).not.toMatch(/<form\b/);
    expect(src.match(/<ChoiceTiles\b/g)).toHaveLength(2);
    expect(src).not.toMatch(/<Button\b/);
  });

  it("routes each group through its handler and its own action (mutation: call setMyThemeAction from the language group -> FAILS)", () => {
    expect(src).toMatch(/changeLanguage\(\{[\s\S]*?setMyLanguageAction/);
    expect(src).toMatch(/changeTheme\(\{[\s\S]*?setMyThemeAction/);
  });

  it("a radio step applies at once but saves through the debouncer, flushed on unmount (fix round 1 M1) (mutation: call changeTheme straight from onChange -> FAILS)", () => {
    expect(src).toMatch(/onChange=\{\(choice\) => \{\s*const next = languageValueOf\(choice\);\s*setLanguage\(next\);\s*languageStep\(next, language\);/);
    expect(src).toMatch(/onChange=\{\(choice\) => \{\s*applyTheme\(choice\);\s*themeStep\(choice, theme\);/);
    expect(src).toContain("return () => { s.language?.flush(); s.theme?.flush(); };");
    expect(src).toContain("s.language ??= debouncedChoice(");
    expect(src).toContain("s.theme ??= debouncedChoice(");
    expect(src).not.toMatch(/onChange=\{\(choice\) =>\s*void change(Theme|Language)\(/);
  });

  it("offers the agency only its own languages (mutation: hard-code languageChoicesFor(false) -> FAILS)", () => {
    expect(src).toContain("languageChoicesFor(isAgency)");
  });

  it("speaks the person's locale through t() (mutation: render m[\"prefs.title\"] raw -> FAILS)", () => {
    expect(src).toContain("useLocale()");
    expect(src).not.toMatch(/\bm\["prefs\./);
  });

  it("uses no hex colour (mutation: add a #fff -> FAILS)", () => {
    expect(src).not.toMatch(HEX);
  });
});

describe("the choice tiles", () => {
  const src = read(path.join(here, "../choice-tiles.tsx"));

  it("is a fieldset radiogroup with a legend and native radios (mutation: swap the native radio for a div -> FAILS)", () => {
    expect(src).toMatch(/<fieldset[^>]*role="radiogroup"/);
    expect(src).toContain("<legend");
    expect(src).toContain('type="radio"');
  });

  it("paints from tokens only: surface-2 at rest, surface-3 on hover over 150ms, accent-dim and line-strong when checked, the control radius, the house focus ring (mutation: drop the checked accent -> FAILS)", () => {
    for (const cls of [
      "bg-[var(--surface-2)]", "hover:bg-[var(--surface-3)]", "duration-150",
      "has-checked:bg-[var(--accent-dim)]", "has-checked:border-[var(--line-strong)]",
      "rounded-[var(--radius-ctl)]", "has-focus-visible:ring-[var(--ring-glow)]", "motion-reduce:transition-none",
    ]) expect(src, cls).toContain(cls);
    expect(src).not.toMatch(HEX);
  });
});

describe("the route's loading and error states", () => {
  it("loading is skeletons shaped like the two cards, never a spinner (mutation: render a Loader2 -> FAILS)", () => {
    const loading = read(path.join(routeDir, "loading.tsx"));
    const panel = read(path.join(here, "preferences-panel.tsx"));
    expect(loading).toContain("<PreferencesSkeleton");
    expect(panel).toMatch(/export function PreferencesSkeleton[\s\S]*<Skeleton\b/);
    expect(loading + panel).not.toMatch(/animate-spin|Loader2|Spinner/);
  });

  it("error is the load sentence with a ghost Reload that refreshes the route (mutation: make Reload a default button -> FAILS)", () => {
    const src = read(path.join(routeDir, "error.tsx"));
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src).toContain('t(m, "prefs.error.load", locale)');
    expect(src).toMatch(/<Button[^>]*variant="ghost"/);
    expect(src).toContain("router.refresh()");
  });
});

describe("the user menu", () => {
  const src = read(path.join(here, "../user-menu.tsx"));

  it("adds one Clerk link to /dashboard/preferences with a localized label, keeping Clerk's own items (mutation: drop the href -> FAILS)", () => {
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src).toMatch(/<UserButton\.MenuItems>\s*<UserButton\.Link[\s\S]*href="\/dashboard\/preferences"/);
    expect(src).toContain('t(m, "prefs.menuItem", locale)');
  });
});
