import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Button } from "./button";
import { Badge } from "./badge";
import { Input } from "./input";
import { Textarea } from "./textarea";

const here = path.dirname(fileURLToPath(import.meta.url));
const cls = (html: string) => html.match(/class="([^"]*)"/)![1]!;

describe("Button variants (spec §4)", () => {
  it("primary = gradient + glow, no flat bg-primary", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, null, "Go")));
    expect(c).toMatch(/\bbtn-primary\b/);
    expect(c).toMatch(/\btext-primary-foreground\b/);
    expect(c).not.toMatch(/\bbg-primary\b/);
  });
  it("outline = surface-1 fill, strong line, no shadow", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, { variant: "outline" }, "x")));
    expect(c).toMatch(/\bbg-card\b/);
    expect(c).toMatch(/border-\[var\(--line-strong\)\]/);
    expect(c).not.toMatch(/shadow-xs/);
    // Light theme's --surface-2 is white on cards (same as --surface-1), so
    // outline's hover must step to --surface-3 to be visible in light mode.
    expect(c).toContain("hover:bg-[var(--surface-3)]");
  });
  it("ghost = transparent until hover, surface-3 hover, no accent classes", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, { variant: "ghost" }, "x")));
    // Same white-surface-2-in-light reasoning as outline above.
    expect(c).toContain("hover:bg-[var(--surface-3)]");
    expect(c).not.toMatch(/\bbg-accent\b|\bhover:bg-accent\b/);
  });
  it("destructive = crit-bg fill, crit text, no gradient", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, { variant: "destructive" }, "x")));
    expect(c).toContain("bg-[var(--crit-bg)]");
    expect(c).toContain("text-[var(--crit)]");
    expect(c).not.toMatch(/\bbtn-primary\b|\btext-white\b/);
  });
});

// The mockup's .input (northern-lights.html:145): --input-bg rgba(255,255,255,.04)
// — HALF the old --surface-2 fill — on --input-line, 8px (--r-ctl, not the card
// radius minus 2), 13px, and no invented shadow. The focus treatment is unchanged.
describe("text controls: the mockup's --input-bg fill, accent border + 3px ring-glow on focus", () => {
  it.each([
    ["input", () => cls(renderToStaticMarkup(createElement(Input)))],
    ["textarea", () => cls(renderToStaticMarkup(createElement(Textarea)))],
    ["select-trigger", () => readFileSync(path.join(here, "select.tsx"), "utf8").split('data-slot="select-trigger"')[1]!.slice(0, 700)],
  ])("%s", (_name, get) => {
    const c = get();
    expect(c).toContain("bg-[var(--input-bg)]");
    expect(c).toContain("border-[var(--input-line)]");
    expect(c).toContain("rounded-[8px]");
    expect(c).not.toContain("shadow-xs");
    expect(c).toContain("focus-visible:border-[var(--accent)]");
    expect(c).toContain("focus-visible:ring-[3px]");
    expect(c).toContain("focus-visible:ring-[var(--ring-glow)]");
    // Deviation from the brief's literal regex: input.tsx also carries the
    // untouched, out-of-scope "file:bg-transparent" (the <input type=file>
    // pseudo-element skin), which the bare \bbg-transparent\b word-boundary
    // also matches (":" is a non-word char, so a boundary sits right before
    // "bg"). The lookbehind excludes only that exact "file:" variant; a
    // reverted base bg-transparent (preceded by a space, not "file:") still
    // fails this assertion. See task report for verification.
    expect(c).not.toMatch(/(?<!file:)\bbg-transparent\b|dark:bg-input\/30|ring-ring\/50/);
  });
});

describe("Badge fills soften (dot + word rule unchanged)", () => {
  // Light theme's --surface-2 is white on cards (same ladder step as
  // --surface-1), so a badge fill needs --surface-3 to read as a fill at
  // all in light mode; --crit-bg is a distinct token, unaffected by this.
  it("secondary and outline sit on --surface-3; destructive on --crit-bg", () => {
    expect(cls(renderToStaticMarkup(createElement(Badge, { variant: "secondary" }, "x")))).toContain("bg-[var(--surface-3)]");
    expect(cls(renderToStaticMarkup(createElement(Badge, { variant: "outline" }, "x")))).toContain("bg-[var(--surface-3)]");
    const d = cls(renderToStaticMarkup(createElement(Badge, { variant: "destructive" }, "x")));
    expect(d).toContain("bg-[var(--crit-bg)]");
    expect(d).toContain("text-[var(--crit)]");
  });
});

describe("period pills (Website header)", () => {
  const page = readFileSync(path.join(here, "../../app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx"), "utf8");
  it("selected segment uses pill-on; container is surface-1 with --line, at the mockup's 3px inset", () => {
    // RETARGETED (Northern Lights wave 2): the container used to be pinned as
    // `border-border bg-card` — the semantic pair, which a tenant re-points —
    // at `p-0.5` (2px). The mockup's `.pills` (northern-lights.html:70) is a
    // 3px inset on the mode-keyed chrome neutrals; this is page chrome, not a
    // card, so it chooses the mode-keyed side of the tenant seam on purpose.
    expect(page).toMatch(
      /aria-label="Period" className="[^"]*\brounded-full\b[^"]*border-\[var\(--line\)\][^"]*bg-\[var\(--surface-1\)\][^"]*\bp-\[3px\]/,
    );
    // The old pair must be gone, not merely outranked further along the string.
    expect(page).not.toMatch(/aria-label="Period" className="[^"]*\bbg-card\b/);
    expect(page).toMatch(/\? "pill-on rounded-full px-3 py-1/);
    expect(page).not.toContain("bg-primary/15");
    // Same white-surface-2-in-light reasoning as the button/badge cases
    // above: the unselected pill's hover must step to --surface-3.
    expect(page).toContain("hover:bg-[var(--surface-3)]");
    expect(page).not.toContain("hover:bg-[var(--surface-2)]");
  });
});
