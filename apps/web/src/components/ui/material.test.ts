// apps/web/src/components/ui/material.test.ts
//
// Card/Skeleton/EmptyState are pure functions of props → renderToStaticMarkup.
// Radix overlays and the sidebar need contexts/hooks, so their class strings
// are read from source (the same data-not-behaviour shape as the CSS tests).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Inbox } from "lucide-react";
import { Card } from "./card";
import { Skeleton } from "./skeleton";
import { EmptyState } from "../empty-state";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");

// The WHOLE first class-string literal of the `className={cn(` call that
// follows an anchor. A fixed-size window around the anchor stops reading
// mid-string on the longer Tailwind lists, so a `bg-popover` appended at the
// tail would pass unseen; every index is asserted so a shape change fails
// loudly instead of silently narrowing what is scanned.
const classLiteralAfter = (text: string, anchor: string) => {
  const start = text.indexOf(anchor);
  expect(start, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const call = text.indexOf("className={cn(", start);
  expect(call, `no className={cn( after: ${anchor}`).toBeGreaterThan(-1);
  const open = text.indexOf('"', call);
  expect(open, `no class literal after: ${anchor}`).toBeGreaterThan(-1);
  const close = text.indexOf('"', open + 1);
  expect(close, `unterminated class literal after: ${anchor}`).toBeGreaterThan(-1);
  return text.slice(open + 1, close);
};

describe("Card is glass (spec §4)", () => {
  const html = renderToStaticMarkup(createElement(Card, null, "x"));
  it("keeps bg-card (a tenant's --card must still win) and adds the glass utility", () => {
    expect(html).toMatch(/class="[^"]*\bbg-card\b[^"]*\bglass\b/);
    expect(html).not.toMatch(/shadow-sm/);
  });
});

describe("Skeleton reads as card material", () => {
  const html = renderToStaticMarkup(createElement(Skeleton));
  it("fills with --surface-3 — the one light step that is not white — and the glass highlight", () => {
    expect(html).toContain("bg-[var(--surface-3)]");
    expect(html).toContain("shadow-[var(--glass-highlight)]");
    expect(html).not.toContain("bg-accent");
  });
});

describe("EmptyState sits on a stronger glow", () => {
  const html = renderToStaticMarkup(createElement(EmptyState, { icon: Inbox, title: "Nothing yet" }));
  it("paints an --accent-dim radial at its top-left corner", () => {
    expect(html).toContain("bg-[radial-gradient(420px_220px_at_0%_0%,var(--accent-dim),transparent_70%)]");
  });
});

describe("overlays float on --surface-overlay (opaque-over-scroll rule)", () => {
  it.each([
    ["dialog.tsx", "dialog-content"], ["sheet.tsx", "sheet-content"], ["popover.tsx", "popover-content"],
    ["select.tsx", "select-content"], ["dropdown-menu.tsx", "dropdown-menu-content"], ["command.tsx", '"command"'],
  ])("%s's %s uses glass-overlay, not bg-background/bg-popover", (file, slot) => {
    const literal = classLiteralAfter(
      src(`./${file}`),
      `data-slot=${slot.startsWith('"') ? slot : `"${slot}"`}`,
    );
    expect(literal).toContain("glass-overlay");
    expect(literal).not.toMatch(/\bbg-background\b|\bbg-popover\b/);
  });

  it("dropdown sub-content is an overlay too", () => {
    const literal = classLiteralAfter(src("./dropdown-menu.tsx"), 'data-slot="dropdown-menu-sub-content"');
    expect(literal).toContain("glass-overlay");
    expect(literal).not.toMatch(/\bbg-background\b|\bbg-popover\b/);
    expect(src("./dropdown-menu.tsx").match(/glass-overlay/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("table rows hover to --surface-3 (raised, visible in both themes), select to --accent-dim, and never blur", () => {
    const row = classLiteralAfter(src("./table.tsx"), 'data-slot="table-row"');
    expect(row).toContain("hover:bg-[var(--surface-3)]");
    expect(row).toContain("data-[state=selected]:bg-[var(--accent-dim)]");
    expect(row).not.toMatch(/glass|blur/);
  });

  it("toasts are overlays with the strong line and the overlay shadow inline (sonner's own rule outranks the utility)", () => {
    const t = src("./sonner.tsx");
    expect(t).toContain('"--normal-border": "var(--line-strong)"');
    expect(t).toContain('className: "glass-overlay"');
    expect(t).toContain('boxShadow: "var(--shadow-overlay)"');
  });
});

describe("shell chrome", () => {
  it("topbar is transparent with a bottom hairline", () => {
    expect(src("../topbar.tsx")).toMatch(/<header className="[^"]*\bbg-transparent\b[^"]*\bborder-b\b|<header className="[^"]*\bborder-b\b[^"]*\bbg-transparent\b/);
  });
  it("the presence dot carries the --good halo", () => {
    expect(src("../topbar-presence.tsx")).toContain("shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]");
  });
  it("sidebar: blur, right hairline, gradient rail, token badges, no white alpha or text-white literals", () => {
    const s = src("../app-sidebar.tsx");
    expect(s).toMatch(/className=\{cn\(\s*"[^"]*\bsidebar-chrome\b/);
    // The mockup's `.side { border-right: 1px solid var(--side-line) }`. It has
    // to sit on the aside's OWN class string — a wrapper would not follow the
    // collapse width transition, and a child would draw inside the padding.
    expect(s).toMatch(/className=\{cn\(\s*"[^"]*\bsidebar-chrome\b[^"]*\bborder-r\b[^"]*border-\[var\(--sidebar-line\)\]/);
    expect(s).toContain("bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).toContain("bg-[linear-gradient(135deg,var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).toContain("bg-[linear-gradient(90deg,var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).not.toMatch(/hover:bg-white\/5|bg-white\/10|\btext-white\b|var\(--accent-2\)/);
    // The identity chip is the mockup's avatar: white ink on the gradient.
    // --sidebar-ground is transparent in dark, so it would erase the glyph.
    expect(s).toContain(
      "bg-[linear-gradient(135deg,var(--sidebar-accent),var(--sidebar-tint-2))] text-[var(--sidebar-text-strong)]",
    );
    expect(s).not.toContain("text-[var(--sidebar-ground)]");
    // The active pill's hairline is chrome, not the theme-keyed glass one:
    // --glass-highlight is a .9 white line in light, on an always-dark rail.
    expect(s).toContain("shadow-[inset_0_1px_0_var(--sidebar-line)]");
    expect(s).not.toContain("shadow-[var(--glass-highlight)]");
  });
});
