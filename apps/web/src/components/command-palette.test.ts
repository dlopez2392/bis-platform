import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as palette from "./command-palette";
import { PaletteHitContent } from "./command-palette";
import type { SearchHit } from "@/app/api/accounts/[accountId]/search/route";

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
    expect(src).toMatch(/toggleTheme\(\s*resolvedTheme,\s*setTheme,\s*\(\) => router\.refresh\(\),/);
    expect(src).not.toMatch(/setTheme\(resolvedTheme === "dark" \? "light" : "dark"\)/);
  });

  // Mis preferencias (D5): the palette's toggle shares the SAME
  // persist/onPersistFailed pair as the topbar's own button (theme-toggle.tsx),
  // not a third, incomplete copy of toggleTheme's first three arguments.
  it("also persists the choice and reports a failed save with the same toast as the topbar button (mutation: drop the persist or onPersistFailed argument → FAILS)", () => {
    expect(src).toMatch(/toggleTheme\(\s*resolvedTheme,\s*setTheme,\s*\(\) => router\.refresh\(\),\s*setMyThemeAction,\s*\(\) => toast\.error\(t\(m, "theme\.saveFailed", locale\)\),?\s*\)/);
  });
});

// F-107 r1 review (item 8): below `sm` the topbar had no search entry point
// at all (the desktop trigger was simply hidden) — §6.3 keeps "a search
// icon" in the phone topbar. Two triggers, one `open` state, same
// accessible name.
describe("CommandPalette — F-107 r1: a phone keeps a search entry point (icon-only, below `sm`)", () => {
  it("the mobile trigger is visible below `sm` and hidden at sm+ (mutation: drop `sm:hidden` → both triggers show everywhere)", () => {
    expect(src).toMatch(/size="icon-sm"[\s\S]{0,120}aria-label=\{t\(m, "shell\.search", locale\)\}[\s\S]{0,120}className="sm:hidden"/);
  });

  it("the desktop trigger is hidden below `sm` and visible at sm+ (mutation: drop `hidden`/`sm:inline-flex` → it shows below `sm` too, 300px wide)", () => {
    expect(src).toContain('className="hidden gap-2 text-muted-foreground sm:inline-flex"');
  });

  it("both triggers open the SAME dialog state, carry the SAME accessible name, and name the SAME keyboard shortcut (F-107 r2 review, item 5)", () => {
    expect(src.match(/onClick=\{\(\) => setOpen\(true\)\}/g)?.length).toBe(2);
    expect(src.match(/aria-label=\{t\(m, "shell\.search", locale\)\}/g)?.length).toBe(2);
    expect(src.match(/aria-keyshortcuts=\{isMac \? "Meta\+K" : "Control\+K"\}/g)?.length).toBe(2);
  });
});

// F-092 part 1 (plan Task 7): the CONTACTS group only sets the matched letters in weight 600.
// PaletteHitContent needs none of CommandPalette's hooks (usePathname, useRouter, useTheme,
// useSyncExternalStore) or cmdk's own filtering, so it renders directly, unlike the rest of this file.
describe("PaletteHitContent — F-092 part 1: the CONTACTS group highlights, calls/conversations do not", () => {
  const contactHit: SearchHit = {
    id: "c1", label: "María García", sublabel: "(956) 555-0199", at: null, href: "/x",
  };
  const callHit: SearchHit = {
    id: "k1", label: "María García", sublabel: "Missed call", at: "2026-10-01T00:00:00Z", href: "/y",
  };

  it("a contacts hit marks the matched letters in the label (mutation: pass groupKey='calls' for a contacts row -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(PaletteHitContent, { groupKey: "contacts", hit: contactHit, query: "garcia" }));
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>García<\/mark>/);
  });

  it("a contacts hit marks the matched digits in the sublabel (mutation: use hit.label instead of hit.sublabel for phoneRanges -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(PaletteHitContent, { groupKey: "contacts", hit: contactHit, query: "0199" }));
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>0199<\/mark>/);
  });

  it("a calls hit renders no mark at all, even though its label matches the same query (mutation: drop the isContacts guard -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(PaletteHitContent, { groupKey: "calls", hit: callHit, query: "garcia" }));
    expect(html).not.toContain("<mark");
    expect(html).toContain("María García");
    // The sublabel and the date still join with " · ", exactly as before this task.
    expect(html).toContain("Missed call");
    expect(html).toMatch(/Missed call\s*·/);
  });

  it("the ' · date' join stays outside the mark: a query matching only the formatted date's own digits (never the phone's) marks nothing (mutation: join sublabel and date into one string before calling phoneRanges -> the date's '2026' would be found and wrongly marked -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(PaletteHitContent, {
      groupKey: "contacts",
      hit: { id: "c2", label: "Ana Ruiz", sublabel: "(956) 555-0199", at: "2026-10-01T00:00:00Z", href: "/z" },
      query: "2026",
    }));
    expect(html).not.toContain("<mark");
    expect(html).toContain("2026");
  });
});

// F-092 final review M-4a: a stand-in label is not the customer's name, so nothing in it is marked.
describe("PaletteHitContent — a nameless contact's stand-in label is never marked", () => {
  it("'Unnamed contact' found by its email 'contact@…' marks nothing in the label (mutation: ignore hit.unnamed -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(PaletteHitContent, {
      groupKey: "contacts",
      hit: { id: "c3", label: "Unnamed contact", unnamed: true, sublabel: "contact@roofs.example", at: null, href: "/c" },
      query: "contact",
    }));
    expect(html).not.toContain("<mark");
    expect(html).toContain("Unnamed contact");
  });
});

describe("CommandPalette — wires the CONTACTS group through PaletteHitContent (source)", () => {
  it("imports HighlightedText and the two range functions, and renders a live hit through PaletteHitContent (mutation: render {hit.label} inline again -> FAILS)", () => {
    expect(src).toMatch(/import\s*\{\s*HighlightedText\s*\}\s*from\s*"@\/components\/highlighted-text"/);
    expect(src).toMatch(/import\s*\{\s*nameRanges,\s*phoneRanges\s*\}\s*from\s*"@\/lib\/contacts\/search-highlight"/);
    expect(src).toContain("<PaletteHitContent groupKey={group.key} hit={hit} query={query} />");
  });
});

// Staff and roles (Task 8): isOwner is threaded to buildPaletteEntries, not
// dropped on the way through. Source-only, same reasoning as every other
// block in this file.
describe("CommandPalette — threads isOwner to buildPaletteEntries (staff and roles)", () => {
  it("takes an isOwner prop and passes it as buildPaletteEntries' third argument (mutation: call buildPaletteEntries(base, isAgency) with only two args → FAILS)", () => {
    expect(src).toMatch(/export function CommandPalette\(\{\s*isAgency,\s*isOwner,\s*isTechnician,\s*\}/);
    expect(src).toContain("filterEntries(buildPaletteEntries(base, isAgency, isOwner, isTechnician, locale), query)");
  });
  // F-085 part 1 (spec §9): the ⌘K index leaves out the routes a Technician
  // cannot enter, which buildPaletteEntries does from its fourth argument.
  it("takes an isTechnician prop and passes it as buildPaletteEntries' fourth argument (mutation: drop it → FAILS)", () => {
    expect(src).toMatch(/isTechnician: boolean;/);
    expect(src).toContain("buildPaletteEntries(base, isAgency, isOwner, isTechnician, locale)");
  });
  // S-10 T1: the entries are labelled in the reader's language, from the
  // LocaleProvider the dashboard layout seeds.
  it("passes the reader's locale as buildPaletteEntries' fifth argument (mutation: drop it → FAILS)", () => {
    expect(src).toContain("const locale = useLocale();");
    expect(src).toContain("buildPaletteEntries(base, isAgency, isOwner, isTechnician, locale)");
  });
});

// F-092 final review M-5: the palette sent sanitizeSearchTerm(query), which escapes "_" to "\_", so
// "john_doe@x.com" reached the route as "john\_doe@x.com" and the exact-email tier (which compares the typed
// address to email_key) could never fire from ⌘K. The route sanitizes for itself (its own F-092 comment); the
// palette sends the trimmed RAW query, and keeps the floor on searchTermLength.
describe("CommandPalette — sends the trimmed raw query, never a sanitized one (F-092 final review M-5)", () => {
  const url = (accountId: string, query: string) =>
    (palette as unknown as { paletteSearchUrl: (a: string, q: string) => string }).paletteSearchUrl(accountId, query);

  it("an email with an underscore reaches the route exactly as typed, trimmed (mutation: sanitizeSearchTerm(query) -> FAILS)", () => {
    expect(typeof (palette as Record<string, unknown>).paletteSearchUrl).toBe("function");
    const sent = new URL(url("a1", "  john_doe@x.com "), "http://x");
    expect(sent.pathname).toBe("/api/accounts/a1/search");
    expect(sent.searchParams.get("q")).toBe("john_doe@x.com");
  });

  it("the live fetch builds its URL through paletteSearchUrl, and nothing in the palette sanitizes (mutation: fetch with encodeURIComponent(sanitizeSearchTerm(query)) -> FAILS)", () => {
    expect(src).not.toContain("sanitizeSearchTerm(");
    expect(src).toMatch(/fetch\(paletteSearchUrl\(accountId, q\)/);
    expect(src).toMatch(/const q = query\.trim\(\);/);
    expect(src).toMatch(/searchTermLength\(query\) >= MIN_QUERY/);
  });
});
