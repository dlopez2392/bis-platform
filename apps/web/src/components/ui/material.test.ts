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
import { Notice } from "./notice";
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

// ---------------------------------------------------------------------------
// Northern Lights, all sections — wave 1. The shared surfaces the per-section
// pass kept re-implementing. Each of these was UNPINNED before this block,
// which is precisely why the fidelity pass walked past them.
// ---------------------------------------------------------------------------

describe("PageHeader is not a card", () => {
  const s = src("../page-header.tsx");
  it("carries NO fill and NO bottom rule — the mockup's .page-head is a bare flex row over the aurora", () => {
    // The one edit that treats all 14 routes: an opaque --surface-1 slab sat
    // exactly over the ground's brightest glow (`12% -10%`) on every screen.
    expect(s).not.toContain("bg-card");
    expect(s).not.toContain("border-b");
    // Its INTERNAL rule (row 3) is the mockup's row rule, not --line.
    expect(s).toContain("border-t border-[var(--row-line)]");
    // And the head's own top padding is `.content`'s 22px, not 20.
    expect(s).toContain("pt-[22px]");
  });
  it("the dashboard greeting uses the component instead of a second copy of it", () => {
    const page = src("../../app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx");
    expect(page).toContain("<PageHeader");
    expect(page).not.toContain("border-b border-border bg-card");
  });
});

describe("TableHead carries the Label role", () => {
  const head = classLiteralAfter(src("./table.tsx"), 'data-slot="table-head"');
  it("is Geist Mono 500, 10px, +0.14em, uppercase (DESIGN.md's third type role)", () => {
    expect(head).toContain("font-mono");
    expect(head).toContain("text-[10px]");
    expect(head).toContain("tracking-[0.14em]");
    expect(head).toContain("uppercase");
    // 14px sans is what eight tables rendered before this moved here.
    expect(head).not.toContain("text-foreground");
  });
  it("no table paints a filled header band — the mockup separates with rules, never fills", () => {
    expect(src("../../app/(dashboard)/dashboard/accounts/[accountId]/calls/calls-table.tsx"))
      .not.toContain("bg-muted/40");
  });
});

describe("ListPanel is the one list-card idiom", () => {
  const s = src("./list-panel.tsx");
  it("keeps bg-card BEFORE glass, the same order Card uses", () => {
    expect(s).toMatch(/\bbg-card\b[^"]*\bglass\b/);
    expect(s).toContain("rounded-xl");
  });
  it("rules its rows with --row-line, never divide-border (--line is a third stronger)", () => {
    expect(s).toContain("border-t border-[var(--row-line)] first:border-t-0");
  });
  it("retired every hand-rolled copy: no list panel still divides on --border", () => {
    const app = "../../app/(dashboard)/dashboard";
    for (const rel of [
      `${app}/accounts/[accountId]/forms/page.tsx`,
      `${app}/blueprints/blueprints-table.tsx`,
      `${app}/accounts/[accountId]/conversations/conversation-list.tsx`,
      `${app}/accounts/[accountId]/contacts/contacts-table.tsx`,
      `${app}/accounts/[accountId]/calls/calls-table.tsx`,
      `${app}/accounts/[accountId]/pipeline/pipeline-board.tsx`,
    ]) {
      expect(src(rel), rel).not.toContain("divide-y divide-border");
      expect(src(rel), rel).toContain("ListPanel");
    }
  });
});

describe("Notice is the one status banner", () => {
  it("is a tinted ground with a TRANSPARENT border (the mockup's .chip.good/.warn/.crit)", () => {
    // Rendered, not read from source: the file's own doc comment names the
    // classes it is explaining, so a source scan would pass on the prose.
    const warn = renderToStaticMarkup(createElement(Notice, { tone: "warn" }, "x"));
    const crit = renderToStaticMarkup(createElement(Notice, { tone: "crit" }, "x"));
    const good = renderToStaticMarkup(createElement(Notice, { tone: "good" }, "x"));
    expect(warn).toContain("border-transparent");
    expect(warn).toContain("bg-[var(--warn-bg)]");
    expect(crit).toContain("bg-[var(--crit-bg)]");
    expect(good).toContain("bg-[var(--good-bg)]");
    // An alpha of the hue used as an OUTLINE is what the ten copies did.
    expect(warn).not.toMatch(/border-(warning|destructive)\//);
    // Nested in a card, a dialog or a sheet in every case.
    expect(warn).not.toMatch(/\bglass\b/);
    expect(warn).toContain('role="alert"');
  });
  it("no banner still hand-rolls the border-{warning,destructive}/40 box", () => {
    const app = "../../app/(dashboard)/dashboard/accounts/[accountId]";
    for (const rel of [
      `${app}/setup/setup-shell.tsx`,
      `${app}/setup/page.tsx`,
      `${app}/checklist/page.tsx`,
      `${app}/setup/setup-enable-test-calls-button.tsx`,
      `${app}/setup/setup-go-live-button.tsx`,
      `${app}/setup/setup-move-number-button.tsx`,
      `${app}/settings/save-blueprint-dialog.tsx`,
      `${app}/calendar/calendar-settings.tsx`,
      `${app}/contacts/contact-drawer.tsx`,
    ]) {
      expect(src(rel), rel).not.toMatch(/border-(warning|destructive)\/40/);
    }
  });
});

describe("Meter is the one progress bar", () => {
  const s = src("../meter.tsx");
  it("is the mockup's 5px track on --meter-bg with the CONTENT accent pair", () => {
    expect(s).toContain("h-[5px]");
    expect(s).toContain("bg-[var(--meter-bg)]");
    expect(s).toContain("bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]");
    // A themed tenant re-points --accent but not --sidebar-*; a shared meter
    // painted from the sidebar's chrome tokens goes wrong on every brand.
    expect(s).not.toContain("--sidebar-accent");
  });
  it("no content-area meter is still 6px on --surface-3 with a flat fill", () => {
    const app = "../../app/(dashboard)/dashboard/accounts/[accountId]";
    for (const rel of [`${app}/calls/page.tsx`, `${app}/setup/setup-panel.tsx`]) {
      expect(src(rel), rel).not.toContain("h-1.5 w-full overflow-hidden rounded-full bg-muted");
    }
  });
});

describe("native <textarea> paints like Input", () => {
  it("one exported string (all seven call sites are textareas, not selects), and no file still carries the transparent copy", () => {
    expect(src("./input.tsx")).toContain("export const nativeFieldClass");
    // bg-transparent on a translucent card is the actual visible bug.
    expect(src("./input.tsx")).toContain("bg-[var(--input-bg)]");
    const app = "../../app/(dashboard)/dashboard/accounts/[accountId]";
    for (const rel of [`${app}/calendar/calendar-settings.tsx`, `${app}/voice/voice-settings.tsx`]) {
      expect(src(rel), rel).not.toContain("bg-transparent px-3 py-1.5 text-sm shadow-xs");
    }
  });
});

describe("the raised hover step is one colour", () => {
  it(".row-interactive:hover is --surface-3, the same step ui/table.tsx uses", () => {
    const css = src("../../styles/tokens.css");
    expect(css).toContain(".row-interactive:hover { background: var(--surface-3); }");
    expect(css).not.toContain(".row-interactive:hover { background: var(--surface-2); }");
  });
});

describe("the routes above dashboard/layout.tsx get a ground of their own", () => {
  it("no-access and the landing page mount <Ground /> so their glass has something to be glass over", () => {
    for (const rel of ["../../app/(dashboard)/no-access/page.tsx", "../../app/(dashboard)/page.tsx"]) {
      const s = src(rel);
      expect(s, rel).toContain("<Ground />");
      expect(s, rel).toContain('from "@/components/ground"');
      // A fixed -z-10 child needs a positioned ancestor to sit behind.
      expect(s, rel).toMatch(/<main className="relative /);
      expect(s, rel).toMatch(/\bbg-card\b[^"]*\bglass\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// Northern Lights, all sections — WAVE 2, the per-section surfaces. Wave 1
// treated the shared components; these are the ~25 hand-rolled
// `rounded-lg border border-border bg-card` panels the fidelity pass left
// flat, plus the per-section details. Same reasoning as the block above: a
// surface nobody pins is a surface the next pass walks past.
// ---------------------------------------------------------------------------

const APP = "../../app/(dashboard)/dashboard";
const ACCT = `${APP}/accounts/[accountId]`;

/** `bg-card` then `glass`, the one true card string, anywhere in the file. */
const hasGlassCard = (s: string) => /\bbg-card\b[^"]*\bglass\b/.test(s);

describe("wave 2 — no section still hand-rolls a flat card", () => {
  // Every file here rendered at least one `rounded-lg border border-border
  // bg-card` panel before wave 2. The negative is the load-bearing half: a
  // future panel added in the old shape fails here even if the glass one
  // beside it still passes.
  const flat = [
    `${ACCT}/calls/page.tsx`,
    `${ACCT}/calls/[callId]/page.tsx`,
    `${ACCT}/contacts/[contactId]/page.tsx`,
    `${ACCT}/contacts/[contactId]/activity-timeline.tsx`,
    `${ACCT}/contacts/bulk-action-bar.tsx`,
  ];
  it.each(flat)("%s carries no `rounded-lg border border-border bg-card`", (rel) => {
    expect(src(rel)).not.toContain("rounded-lg border border-border bg-card");
  });
});

describe("wave 2 — calls", () => {
  it("the usage card and the call-detail CARD are glass", () => {
    expect(hasGlassCard(src(`${ACCT}/calls/page.tsx`))).toBe(true);
    const detail = src(`${ACCT}/calls/[callId]/page.tsx`);
    // One constant, six stacked sections — none of them was glass.
    expect(detail).toContain('const CARD = "overflow-hidden rounded-xl border border-border bg-card glass"');
  });
  it("CARD_HEAD is the Label role, not 12px sans at tracking-wider", () => {
    const detail = src(`${ACCT}/calls/[callId]/page.tsx`);
    expect(detail).toMatch(/const CARD_HEAD =\s*\n?\s*"[^"]*font-mono[^"]*text-\[10px\][^"]*tracking-\[0\.14em\][^"]*uppercase"/);
    expect(detail).not.toContain("text-xs font-medium tracking-wider text-muted-foreground uppercase");
    // The rule under a card header is --row-line like every other row rule.
    expect(detail).toContain("border-b border-[var(--row-line)]");
  });
  it("the transcript facts block takes ladder step 2 and NEVER glass (it is nested in CARD)", () => {
    const detail = src(`${ACCT}/calls/[callId]/page.tsx`);
    expect(detail).toContain("bg-[var(--surface-2)] px-4 py-3 font-mono");
    expect(detail).not.toContain("bg-muted/50");
    // A second --shadow-card inside the first doubles the ambient.
    expect(detail).not.toMatch(/bg-\[var\(--surface-2\)\][^"]*\bglass\b/);
  });
  it("the outcome pill is the mockup's neutral chip with a 7px dot, not a --surface-3 outline with a 6px speck", () => {
    const pill = src(`${ACCT}/calls/outcome-pill.tsx`);
    expect(pill).toContain('variant="chip"');
    expect(pill).not.toContain('variant="outline"');
    expect(pill).toContain("size-[7px] rounded-full");
    expect(pill).not.toContain("size-1.5");
  });
});

describe("wave 2 — contacts", () => {
  it("the bulk-action bar is a BAND inside the ListPanel, not a card floating in one", () => {
    const bar = src(`${ACCT}/contacts/bulk-action-bar.tsx`);
    expect(bar).toContain("border-b border-[var(--row-line)] bg-[var(--surface-2)]");
    expect(bar).not.toContain("bg-card");
    expect(bar).not.toContain("rounded-lg");
    expect(bar).not.toMatch(/\bglass\b/);
  });
  it("the opportunities aside is glass and its rows are rules, never boxes", () => {
    const page = src(`${ACCT}/contacts/[contactId]/page.tsx`);
    expect(hasGlassCard(page)).toBe(true);
    expect(page).toContain("border-t border-[var(--row-line)] py-[7px] first:border-t-0");
    expect(page).not.toContain('className="rounded-md border border-border p-2"');
  });
  it("the five timeline events are ROWS in the one Card, not five stacked cards", () => {
    const tl = src(`${ACCT}/contacts/[contactId]/activity-timeline.tsx`);
    // Five card shadows piling up inside one glass Card was the failure.
    expect(tl).not.toContain("bg-card p-3");
    expect(tl).toContain("border-t border-[var(--row-line)] first:border-t-0");
    // Dashed edges use the INTERACTIVE line token.
    expect(tl).toContain("border-dashed border-[var(--line-strong)]");
    expect(tl).not.toContain("border-dashed border-border");
  });
});

describe("wave 2 — conversations", () => {
  const thread = src(`${ACCT}/conversations/message-thread.tsx`);
  it("the thread pane is glass — the blur is on the CARD, never on the scrolling rows", () => {
    expect(hasGlassCard(thread)).toBe(true);
    expect(thread).toContain("rounded-xl");
    expect(thread).toContain("border-b border-[var(--row-line)]");
    expect(thread).toContain("border-t border-[var(--row-line)] p-4");
  });
  it("message bubbles are ladder step 2 / --accent-dim and NEVER glass (hundreds per thread)", () => {
    expect(thread).toContain("ml-auto bg-[var(--accent-dim)]");
    expect(thread).toContain('"bg-[var(--surface-2)]"');
    // An un-tokenised alpha of the brand colour is what outbound carried.
    expect(thread).not.toContain("bg-primary/10");
    expect(thread).not.toContain("bg-secondary");
    // The bubble's own class list must not pick up the card material.
    expect(thread).not.toMatch(/max-w-\[75%\][^"]*\bglass\b/);
  });
  it("the pick-a-thread pane is the sanctioned EmptyState, not a bare dashed box", () => {
    const page = src(`${ACCT}/conversations/page.tsx`);
    expect(page).toContain('<EmptyState icon={MessagesSquare} title={m["conversations.pickThread"]} />');
    expect(page).not.toContain("rounded-lg border border-dashed border-border p-6");
  });
});

describe("wave 2 — pipeline", () => {
  const board = src(`${ACCT}/pipeline/pipeline-board.tsx`);
  it("the column body is a WELL — step 2 with the interactive dashed edge — not a card", () => {
    expect(board).toContain("border-[var(--line-strong)] bg-[var(--surface-2)]");
    expect(board).toContain("border-[var(--accent)] bg-[var(--accent-dim)]");
    expect(board).not.toContain("border-primary/50 bg-primary/5");
    expect(board).not.toContain("border-border/70 bg-muted/40");
  });
  it("the drag state uses the accent-tinted overlay shadow, never a grey Tailwind blur", () => {
    expect(board).toContain("shadow-[var(--shadow-overlay)] ring-1 ring-[var(--accent)]");
    // DESIGN.md: never gray blur shadows in either mode.
    expect(board).not.toContain("shadow-lg");
    expect(board).not.toContain("ring-primary/40");
  });
  it("the opportunity card lands on the 12px card radius and stays UN-GLASSED pending a frame reading", () => {
    // 40+ blurred cards can share one viewport here. DESIGN.md's own
    // amendment records cards being un-blurred for a morning over a measured
    // 7-9 dropped frames of 52; the findings license glass here only after a
    // reading on real hardware, which no headless run can give.
    expect(board).toContain('"rounded-xl border border-border bg-card p-3"');
    expect(board).not.toMatch(/bg-card p-3",\s*\n?\s*\/\/[^\n]*\n?\s*dragging && "[^"]*glass/);
    expect(board).not.toMatch(/\bbg-card\b[^"]*\bglass\b/);
  });
});

describe("wave 2 — website, the three surfaces the fidelity pass missed", () => {
  it("the waiting card is glass and speaks the display role at 24/600", () => {
    const page = src(`${ACCT}/website/page.tsx`);
    expect(hasGlassCard(page)).toBe(true);
    expect(page).toContain('font-display text-[24px] font-[600] leading-[1.15] tracking-[-0.02em]');
    // 18px at weight 650 — a weight the three type roles do not contain.
    expect(page).not.toContain("font-[650]");
  });
  it("the device strip is one hue in three strengths on --share-bg, and the tail is --accent-2", () => {
    const strip = src(`${ACCT}/website/device-strip.tsx`);
    expect(strip).toContain("bg-[var(--share-bg)]");
    // `bg-accent` here was --surface-3 (.09), 29% too bright for a track.
    expect(strip).not.toContain('rounded-full bg-accent"');
    expect(strip).toContain('"bg-[var(--accent)]"');
    expect(strip).toContain('"bg-[var(--accent-2)]"');
    // The BORDER token as a chart series made the tablet share read as a gap.
    expect(strip).not.toContain('"bg-border"');
    expect(strip).not.toContain("bg-primary");
  });
  it("the breakdown share fill names the accent, not the shadcn semantic a tenant re-points", () => {
    const panel = src(`${ACCT}/website/breakdown-panel.tsx`);
    expect(panel).toContain("rounded-full bg-[var(--accent)]");
    expect(panel).not.toContain("bg-primary");
  });
});
