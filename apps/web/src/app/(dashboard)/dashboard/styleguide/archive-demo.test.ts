import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

// The contact archive's components on /styleguide (final review M4; DESIGN.md's DoD: a new component is on
// the styleguide). Server actions are never called by a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../accounts/[accountId]/contacts/archive-actions", () => ({
  archiveContactsAction: vi.fn(), restoreContactsAction: vi.fn(), contactDeleteBlockersAction: vi.fn(),
}));
vi.mock("../accounts/[accountId]/contacts/actions", () => ({}));
const { ArchiveDemo } = await import("./archive-demo");
const { m } = await import("@/lib/messages");

describe("styleguide: the contact archive (final review M4)", () => {
  const html = renderToStaticMarkup(createElement(ArchiveDemo));
  const text = renderedText(html);

  it("ArchiveControls in both states: Archive on an active contact, Restore on an archived one (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-archive-controls/g)).toHaveLength(2);
    expect(html.match(/data-archive-action="archive"/g)).toHaveLength(1);
    expect(html.match(/data-archive-action="restore"/g)).toHaveLength(1);
  });

  it("ArchivedBanner as the record page and the drawer say it", () => {
    expect(html.match(/data-archived-banner/g)).toHaveLength(2);
    expect(text).toContain("Archived Oct 20, 2026 by Ana López. Their calls and texts are kept.");
    expect(text).toContain("Archived Oct 20, 2026. Their calls and texts are kept.");
  });

  it("the bulk delete dialog's body loading, blocked, deletable and in error", () => {
    for (const state of ["loading", "blocked", "deletable", "error"]) expect(html).toContain(`data-sg-delete-state="${state}"`);
    expect(html).toContain("data-delete-kept-skeleton");
    expect(text).toContain(m["contacts.delete.noneDeletable"]);
    expect(text).toContain("1 of these has a history with you and will be kept.");
    expect(text).toContain(m["contacts.delete.blockersFailed"]);
  });

  it("nothing in it is fixed-width, and the demo may shrink, so /styleguide never scrolls sideways at 375px (e2e/phone-width.spec.ts)", () => {
    expect(html).toMatch(/^<div class="[^"]*\bmin-w-0\b/);
    expect(html).not.toMatch(/\bw-\[\d+px\]/);
    expect(html).not.toMatch(/\bmin-w-\[\d+px\]/);
  });

  it("ids are not repeated (four dialog bodies share one page)", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
