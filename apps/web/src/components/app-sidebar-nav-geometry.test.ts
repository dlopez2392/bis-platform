import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIDEBAR_EXPANDED_WIDTH_CLASS, NAV_ROW_GAP_CLASS, NAV_ROW_EXPANDED_PADDING_CLASS,
  NAV_ICON_SIZE_CLASS, NAV_LABEL_TRUNCATE_CLASS,
} from "./app-sidebar";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "app-sidebar.tsx"), "utf8",
);

/**
 * Task 11, fix round 1 (reviewer C1): the styleguide's pseudo-locale
 * overflow demo (locale-nav-demo.tsx) reproduces the real sidebar nav
 * row's truncation geometry using these FIVE exported constants, so the
 * demo's container is a faithful stand-in for the real sidebar at its real
 * expanded width — not a bare, unconstrained span where `scrollWidth ===
 * clientWidth` by construction.
 *
 * The constants are declared, not wired back into SidebarLink's own
 * render: app-sidebar.test.ts already pins the exact literal strings this
 * file builds its JSX from (`"w-16 sm:w-[236px]"`, `"sm:justify-start
 * sm:px-2.5"`, `"hidden min-w-0 flex-1 truncate sm:block"`), byte for
 * byte, for an unrelated F-107 rider suite — composing them through a
 * shared `cn()` call changed each literal's exact substring without
 * changing anything a browser renders, and broke three of those pins for
 * no behavioural difference. Reading the real source here and asserting
 * each constant is still a literal substring of it gets the same
 * "can't silently drift" guarantee without touching that file's own
 * render or its test.
 *
 * Also pins the one piece this lane did NOT extract into a constant: the
 * aside's own `px-3` and the nav's `-mx-3 ... px-3`, which the demo
 * reproduces as a literal `px-3` rather than a sixth export (both sides'
 * own comments explain why the pair nets to one effective inset).
 */
describe("the styleguide nav-geometry demo stays honest about the real sidebar's measurements", () => {
  it("SIDEBAR_EXPANDED_WIDTH_CLASS is still the aside's own expanded-width literal (mutation: change either side's width number without the other → FAILS)", () => {
    expect(SIDEBAR_EXPANDED_WIDTH_CLASS).toBe("w-16 sm:w-[236px]");
    expect(src).toContain(`collapsed ? "w-16" : "${SIDEBAR_EXPANDED_WIDTH_CLASS}"`);
  });

  it("NAV_ROW_GAP_CLASS and NAV_ROW_EXPANDED_PADDING_CLASS are still literal substrings of the real Link row's className (mutation: change the row's real gap/padding without updating these → FAILS)", () => {
    expect(NAV_ROW_GAP_CLASS).toBe("gap-2.5");
    expect(NAV_ROW_EXPANDED_PADDING_CLASS).toBe("sm:px-2.5");
    expect(src).toContain(`relative flex items-center ${NAV_ROW_GAP_CLASS} rounded-[var(--radius-ctl)]`);
    expect(src).toContain(`!collapsed && "sm:justify-start ${NAV_ROW_EXPANDED_PADDING_CLASS}"`);
  });

  it("NAV_ICON_SIZE_CLASS is still the real Icon's own size (mutation: resize the real icon without updating this → FAILS)", () => {
    expect(NAV_ICON_SIZE_CLASS).toBe("size-4");
    expect(src).toContain(`<Icon className="${NAV_ICON_SIZE_CLASS} opacity-90"`);
  });

  it("NAV_LABEL_TRUNCATE_CLASS is still a literal substring of the real label span's className (mutation: drop `truncate` from the real span without updating this → FAILS)", () => {
    expect(NAV_LABEL_TRUNCATE_CLASS).toBe("min-w-0 flex-1 truncate");
    expect(src).toContain(`<span className="hidden ${NAV_LABEL_TRUNCATE_CLASS} sm:block">{item.label}</span>`);
  });

  it("the aside's own px-3 and the nav's -mx-3/px-3 cancellation are both still present (mutation: drop either → FAILS; the demo's own `px-3` literal would then overstate the label's real available width)", () => {
    expect(src).toMatch(/className=\{cn\(\s*"sticky top-0 flex h-dvh shrink-0 flex-col gap-1\.5 sidebar-chrome border-r border-\[var\(--sidebar-line\)\] px-3 pt-3\.5/);
    expect(src).toMatch(/"-mx-3 flex min-h-0 flex-1 flex-col gap-1\.5 overflow-y-auto px-3"/);
  });
});
