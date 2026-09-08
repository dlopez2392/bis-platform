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

describe("Card is glass (spec §4)", () => {
  const html = renderToStaticMarkup(createElement(Card, null, "x"));
  it("keeps bg-card (a tenant's --card must still win) and adds the glass utility", () => {
    expect(html).toMatch(/class="[^"]*\bbg-card\b[^"]*\bglass\b/);
    expect(html).not.toMatch(/shadow-sm/);
  });
});

describe("Skeleton reads as card material", () => {
  const html = renderToStaticMarkup(createElement(Skeleton));
  it("fills with --surface-2 and the glass highlight", () => {
    expect(html).toContain("bg-[var(--surface-2)]");
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
    const text = src(`./${file}`);
    const start = text.indexOf(`data-slot=${slot.startsWith('"') ? slot : `"${slot}"`}`);
    expect(start).toBeGreaterThan(-1);
    const window = text.slice(start, start + 600);
    expect(window).toContain("glass-overlay");
    expect(window).not.toMatch(/\bbg-background\b|\bbg-popover\b/);
  });

  it("dropdown sub-content is an overlay too", () => {
    expect(src("./dropdown-menu.tsx").match(/glass-overlay/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("table rows hover to --surface-2 and never blur", () => {
    const row = src("./table.tsx").slice(src("./table.tsx").indexOf('data-slot="table-row"'), src("./table.tsx").indexOf('data-slot="table-row"') + 300);
    expect(row).toContain("hover:bg-[var(--surface-2)]");
    expect(row).not.toMatch(/glass|blur/);
  });

  it("toasts are overlays with the strong line", () => {
    const t = src("./sonner.tsx");
    expect(t).toContain('"--normal-border": "var(--line-strong)"');
    expect(t).toContain('className: "glass-overlay"');
  });
});

describe("shell chrome", () => {
  it("topbar is transparent with a bottom hairline", () => {
    expect(src("../topbar.tsx")).toMatch(/<header className="[^"]*\bbg-transparent\b[^"]*\bborder-b\b|<header className="[^"]*\bborder-b\b[^"]*\bbg-transparent\b/);
  });
  it("the presence dot carries the --good halo", () => {
    expect(src("../topbar-presence.tsx")).toContain("shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]");
  });
  it("sidebar: blur, gradient rail, token badges, no white literals", () => {
    const s = src("../app-sidebar.tsx");
    expect(s).toMatch(/className=\{cn\(\s*"[^"]*\bsidebar-chrome\b/);
    expect(s).toContain("bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).toContain("bg-[linear-gradient(135deg,var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).toContain("bg-[linear-gradient(90deg,var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).not.toMatch(/hover:bg-white\/5|bg-white\/10|\btext-white\b|var\(--accent-2\)/);
  });
});
