// S-10 T9b (owner decision Q6, 2026-10-31): Clerk's topbar widgets stay
// English until F-117, so they are marked lang="en" inside a shell that reads
// the person's own language. Clerk portals its popovers (the user menu, the
// organization list) into <body> by default, OUTSIDE any wrapper of ours —
// measured on a production build: the menu read "es" with a plain wrapper —
// so the island also hands Clerk its own element as the portal container.
// The browser half is spanish-dashboard.spec.ts ("Clerk's user menu is an
// English island").
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ providers: [] as { getContainer: unknown }[] }));
vi.mock("@clerk/nextjs", () => ({
  UNSAFE_PortalProvider: (props: { getContainer: unknown; children: unknown }) => {
    h.providers.push({ getContainer: props.getContainer });
    return createElement("clerk-portal-provider", null, props.children as never);
  },
}));

const { ClerkEnglishIsland } = await import("./clerk-english-island");
const src = readFileSync(path.join(__dirname, "clerk-english-island.tsx"), "utf8");

beforeEach(() => { h.providers = []; });

describe("ClerkEnglishIsland", () => {
  it("server-renders its children inside lang=\"en\", through Clerk's portal provider (mutation: drop lang, or the provider -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ClerkEnglishIsland, null, createElement("span", null, "menu")));
    expect(html).toMatch(/^<div lang="en"[^>]*><clerk-portal-provider><span>menu<\/span><\/clerk-portal-provider><div data-clerk-portal="" class="absolute"><\/div><\/div>$/);
    expect(h.providers).toHaveLength(1);
    expect(typeof h.providers[0]!.getContainer).toBe("function");
  });

  // The container is its own zero-size, out-of-flow element INSIDE the island,
  // not the island itself: the island is a flex row with a gap, and Clerk's
  // portal wrapper is a static <div>, so mounting into the island would make
  // it a flex item and shift both triggers by one gap whenever a menu opened.
  it("points Clerk's portals at an absolutely positioned element inside the island (mutation: return document.body, or the island itself -> FAILS)", () => {
    expect(src).toMatch(/getContainer=\{\(\) => portalRef\.current\}/);
    expect(src).toMatch(/<div lang="en"[^>]*>[\s\S]*<div ref=\{portalRef\} data-clerk-portal="" className="absolute" \/>\s*<\/div>/);
  });

  it("keeps the topbar's own spacing between the two widgets: the header's gap, tighter below sm (mutation: drop the gap -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ClerkEnglishIsland, null, "x"));
    expect(html).toContain('class="flex items-center gap-2 sm:gap-[14px]"');
  });
});
