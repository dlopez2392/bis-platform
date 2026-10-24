import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Source-only, same convention as app-sidebar.test.ts: Topbar is a server
 * component that renders Clerk's OrganizationSwitcher/UserButton and the
 * client-only CommandPalette/ThemeToggle/TopbarPresence — a render test
 * would need all four mocked for no behavioural payoff a class-string
 * assertion doesn't already cover, and the F-107 defect this pins (a
 * fixed-width box that cannot shrink) is in which CLASSES the wrapper
 * carries, not in anything a DOM query would see differently.
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

const src = stripComments(readFileSync(path.join(here, "topbar.tsx"), "utf8"));

// F-107 (rider part): the ⌘K trigger's wrapper is a fixed 300px box around a
// Button that is itself `shrink-0 whitespace-nowrap` (components/ui/button.tsx)
// — a narrower box would not shrink that button, it would overflow the
// topbar instead. At 375/320px wide, with the sidebar's own 64px taken first,
// 300px alone is already more than what's left.
//
// F-107 r1 review (item 8): command-palette.tsx now renders its OWN
// icon-only trigger below `sm` instead of this wrapper hiding the whole
// thing, so the wrapper just follows: unconstrained width below `sm`, the
// mockup's 300px only at sm+.
//
// F-107 r2 review (item 3): `min-w-0` is `sm:` only — below `sm` the icon
// trigger (32px) is the wrapper's only content, and an unconditional
// `min-w-0` let the wrapper shrink BELOW that, overlapping whatever sits
// to its right (a sibling-overlap bug `assertHeaderChildrenInBounds`,
// phone-width.spec.ts, cannot see — it checks each child's own edges, not
// overlap between them).
describe("Topbar — F-107 r2 / minors-1b item 2: the search wrapper only shrinks to its OWN button's width at sm+", () => {
  it("min-w-[128px] is sm: only; width is unconstrained below `sm` and 300px at sm+ (mutation: drop `sm:` from either → FAILS)", () => {
    expect(src).toContain('<div className="mr-auto flex items-center sm:min-w-[128px] sm:w-[300px]">{palette}</div>');
  });

  // minors-1b item 2: `min-w-0` (no floor at all) let the wrapper shrink past its own 128px button,
  // which then painted outside it and over the status indicator beside it (measured, agency, 640-900px).
  it("the wrapper no longer carries an unconditional min-w-0 at sm+ (mutation: revert to min-w-0 → FAILS)", () => {
    expect(src).not.toContain("sm:min-w-0");
  });
});

// F-107 r4 review (item 1, CRITICAL): Clerk's OrganizationSwitcher trigger
// sizes to the full org name and never shrinks on its own — a long org
// name pushed the header's content left of its own edge at 320px.
//
// F-107 r5 review (item 1, CRITICAL): r4's own fix used a CLASS STRING,
// which this app's own sign-in page already proved does nothing against
// Clerk's unlayered structural CSS-in-JS — superseded by a style object,
// the same mechanism sign-in uses, with a nested `@media` key to make it
// `sm:`-conditional (Emotion's own supported syntax, Clerk's styling
// engine; verified at runtime by the computed-style probe in
// phone-width.spec.ts, not assumed here). The r4 wrapper (a width cap +
// `overflow-hidden`) is gone too: it would clip the trigger's own focus
// ring, and the real fix no longer needs a clipping safety net.
describe("Topbar — F-107 r5: the org-switcher trigger's name is hidden via a STYLE OBJECT, not a class string", () => {
  it("the element value is an object with a nested max-width media query, never a bare class string (mutation: revert to the string `\"hidden sm:block\"` → FAILS)", () => {
    expect(src).toContain(
      'organizationPreviewTextContainer__organizationSwitcherTrigger: {\n'
      + '                maxWidth: 140,\n'
      + '                overflow: "hidden",\n'
      + '                textOverflow: "ellipsis",\n'
      + '                whiteSpace: "nowrap",\n'
      + '                "@media (max-width: 639.98px)": { display: "none" },\n'
      + '              },',
    );
  });

  it("there is no wrapper div clipping the trigger's focus ring (mutation: reintroduce `overflow-hidden` around OrganizationSwitcher → FAILS)", () => {
    expect(src).not.toMatch(/overflow-hidden[\s\S]{0,80}<OrganizationSwitcher/);
  });

  // minors-1b item 2: the org name's own text container is visible from `sm` (only the media query
  // above hides it, below 640px) and had no width cap of its own at all, taking up to 269px there —
  // leaving the search wrapper's own min-w nowhere to shrink into. The cap is on the SAME style key, a
  // sibling of the existing `@media`, never a second wrapper (this file's own overflow-hidden check
  // above still holds: a text-level ellipsis is not a clipping ancestor of the trigger's focus ring).
  it("the org name's own text container is capped and ellipsized (mutation: drop maxWidth/overflow/textOverflow → FAILS)", () => {
    expect(src).toMatch(/organizationPreviewTextContainer__organizationSwitcherTrigger: \{\s*maxWidth: 140,\s*overflow: "hidden",\s*textOverflow: "ellipsis",\s*whiteSpace: "nowrap",/);
  });
});

// F-107 r1 review (item 3): measured over budget at 375px by ~20px with the
// icon-only search trigger (item 8) restored — the header's own 22px/14px
// mockup spacing is now tighter below `sm` only.
describe("Topbar — F-107 r1: tighter gap/padding below `sm` only, the mockup's values restored at sm+", () => {
  it("gap and padding are the tighter values as the base, the mockup's as the sm: override (mutation: drop either `sm:` override → FAILS)", () => {
    expect(src).toContain(
      'className="flex h-[54px] shrink-0 items-center justify-end gap-2 border-b border-[var(--top-line)] '
      + 'bg-transparent px-3 sm:gap-[14px] sm:px-[22px]"',
    );
  });
});

// Staff and roles, spec §6 pin (plan deviation 5): Topbar({ isAgency: false })
// already renders no OrganizationSwitcher — this component's `isAgency` gate
// predates this task — so this task PINS the existing behaviour with a
// regression test rather than changing code. Source-only, same convention as
// the rest of this file: a render test would need OrganizationSwitcher,
// ThemeToggle, TopbarPresence and CommandPalette all mocked for no payoff a
// class/string pin doesn't already cover.
describe("Topbar — spec §6: a client session (isAgency: false) renders no OrganizationSwitcher", () => {
  it("OrganizationSwitcher is rendered only inside the isAgency branch (mutation: render it unconditionally → FAILS)", () => {
    expect(src).toMatch(/isAgency \? \(\s*<OrganizationSwitcher/);
    // The ternary's other branch is `null`, not a second (unconditional)
    // render of the switcher.
    expect(src).toMatch(/<OrganizationSwitcher[\s\S]*?\/>\s*\) : null/);
  });
});

// Mis preferencias (F-096, Task 6): Clerk's UserButton is reached through
// UserMenu, a client component, because UserButton.MenuItems is a static
// property of a client reference this server component cannot read, and
// UserButton.Link's label is a plain string resolved with useLocale().
describe("the user menu", () => {
  it("renders <UserMenu /> and no bare <UserButton /> (mutation: put <UserButton /> back -> FAILS)", () => {
    expect(src).toContain("<UserMenu />");
    expect(src).not.toMatch(/<UserButton\b/);
  });
});
