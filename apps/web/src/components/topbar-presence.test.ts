// apps/web/src/components/topbar-presence.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { onCallText } from "./topbar-presence";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "topbar-presence.tsx"), "utf8");

// F-107 r4 review (item 1): below `sm` the full presence phrase does not
// fit in the topbar next to the icon-only search trigger, ThemeToggle,
// OrganizationSwitcher and UserButton — collapsed to "dot + short word"
// (rule 3: never a bare dot). Source pin, same convention as
// app-sidebar.test.ts: this component has no render harness.
describe("TopbarPresence — F-107 r4: dot + short word below `sm`, the full phrase at sm+", () => {
  it("both states wrap their two variants in one data-testid, not a bare Fragment (mutation: drop either `data-testid=\"topbar-presence\"` → FAILS) — the e2e sweep's own wait needs ONE unambiguous target, since both variants' text overlaps ('this week' in both idle phrases)", () => {
    expect(src.match(/data-testid="topbar-presence"/g)?.length).toBe(2);
  });

  it("the on-call short word is rendered below `sm`, the full phrase at sm+ (mutation: drop `sm:hidden`/`hidden sm:flex` → FAILS)", () => {
    expect(src).toContain('<span className="flex items-center gap-1.5 text-sm text-foreground sm:hidden">');
    expect(src).toContain('<span className="hidden items-center gap-1.5 text-sm text-foreground sm:flex">');
    expect(src).toContain('t(m, "shell.presence.onCallShort", locale)');
  });

  it("the idle short word keeps a dot, never a bare glyph, below `sm` (mutation: drop the dot span or `sm:hidden`/`hidden sm:block` → FAILS)", () => {
    expect(src).toContain('<span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">');
    expect(src).toContain('<span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--good)]" />');
    expect(src).toContain('<span className="hidden text-sm text-muted-foreground sm:block">');
  });
});

// F-107 r5 review (item 2, minor): "{count} this week" didn't say what was
// counted — "calls" restores that, matching the full phrase's own noun
// ("✓ {count} calls handled this week"). The short phrase needs its own
// singular pair for the same reason the full phrase already has one
// (idle/idleOne, above): "1 calls" is wrong, so a weekCount of exactly 1
// must route to idleShortOne, not idleShort with "{count}" substituted.
describe("TopbarPresence — F-107 r5: the idle short phrase names what's counted, with its own singular", () => {
  it("renders the singular key at weekCount === 1 and the plural key (count substituted) otherwise (mutation: always use idleShort.replace → FAILS, since weekCount 1 would read '1 calls' with no singular branch to catch it)", () => {
    expect(src).toContain(
      '        {presence.weekCount === 1\n'
      + '          ? t(m, "shell.presence.idleShortOne", locale)\n'
      + '          : t(m, "shell.presence.idleShort", locale, { count: presence.weekCount })}',
    );
  });
});

// Task 6 (Spanish-runtime lane): the on-call/idle phrases used to read
// `m["shell.presence.*"]` straight off the English catalogue regardless of
// which locale the account resolved to — this is the first place the
// `.es` twins already sitting in messages.ts (onCallShort/idleShort/
// idleShortOne) become reachable. Source pin, same convention as the rest
// of this file: no render harness exists for this component.
describe("TopbarPresence resolves shell.presence.* through useLocale()/t(), not a hard-coded .en lookup", () => {
  it("reads locale from useLocale() and routes every short-form presence string through t() (mutation: revert to the raw m[\"...én\"] lookups → FAILS, all three patterns reappear)", () => {
    expect(src).toMatch(/const locale = useLocale\(\);/);
    expect(src).not.toMatch(/m\["shell\.presence\.onCallShort\.en"\]/);
    expect(src).not.toMatch(/m\["shell\.presence\.idleShort\.en"\]/);
    expect(src).not.toMatch(/m\["shell\.presence\.idleShortOne\.en"\]/);
    expect(src).toMatch(/t\(m, "shell\.presence\.onCallShort", locale\)/);
    expect(src).toMatch(/t\(m, "shell\.presence\.idleShortOne", locale\)/);
    expect(src).toMatch(/t\(m, "shell\.presence\.idleShort", locale, \{ count: presence\.weekCount \}\)/);
  });
});

/**
 * D-063 follow-up (coordinator, cheap/minor): hard-coding "Sofía" in
 * topbar-presence.tsx passed every existing test in this repo — there was
 * none reaching this component at all. `onCallText` is the pure function
 * pulled out of TopbarPresence specifically so this has a test seam without
 * needing a render harness (the repo has no .tsx test convention today).
 */
describe("onCallText", () => {
  it("names the account's OWN configured persona (mutation: hard-code 'Sofía' → FAILS)", () => {
    expect(onCallText("Max")).toBe("Max · on a call");
  });

  it("falls back to 'Sofía' when the persona name is missing", () => {
    expect(onCallText(null)).toBe("Sofía · on a call");
    expect(onCallText(undefined)).toBe("Sofía · on a call");
  });

  it("falls back to 'Sofía' when the persona name is blank (whitespace only)", () => {
    expect(onCallText("   ")).toBe("Sofía · on a call");
  });

  it("trims surrounding whitespace off a real persona name", () => {
    expect(onCallText("  Max  ")).toBe("Max · on a call");
  });

  it("does not re-interpret '$&' in a persona name as a replacement pattern", () => {
    // String.replace treats a STRING second argument as a pattern ($&, $1,
    // …); a function second argument never is. A persona containing one of
    // those sequences must appear verbatim.
    expect(onCallText("Bob's $& Shop")).toBe("Bob's $& Shop · on a call");
  });
});
