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
    expect(src).toContain('m["shell.presence.onCallShort.en"]');
  });

  it("the idle short word keeps a dot, never a bare glyph, below `sm` (mutation: drop the dot span or `sm:hidden`/`hidden sm:block` → FAILS)", () => {
    expect(src).toContain('<span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">');
    expect(src).toContain('<span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--good)]" />');
    expect(src).toContain('<span className="hidden text-sm text-muted-foreground sm:block">');
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
