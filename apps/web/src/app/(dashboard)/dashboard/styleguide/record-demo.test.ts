import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { RecordDemo } = await import("./record-demo");
const { m } = await import("@/lib/messages");

describe("styleguide: the record kit (DoD: /styleguide gains the new components; spec §15)", () => {
  const html = renderToStaticMarkup(createElement(RecordDemo));
  it("RecordLayout at a desk width and a phone width", () => {
    expect(html.match(/data-record-layout/g)).toHaveLength(2);
  });
  it("each fixed-width specimen scrolls inside a box that is not fixed-width itself, and the demo may shrink, so /styleguide never scrolls sideways at phone width (e2e/phone-width.spec.ts; mutation: put the width on the scrolling box -> FAILS)", () => {
    // The demo is a flex ITEM of the Section's `flex flex-wrap` CardContent: without min-w-0 its
    // automatic minimum width is its content's, 1120px.
    expect(html).toMatch(/^<div class="[^"]*\bmin-w-0\b/);
    for (const w of ["1120", "390"]) {
      expect(html).toMatch(new RegExp(`<div class="(?![^"]*w-\\[\\d+px\\])[^"]*\\boverflow-x-auto\\b[^"]*"><div class="[^"]*w-\\[${w}px\\]`));
    }
  });
  it("the two layouts share no id and carry no skip link: the styleguide has one page's worth of each (design check 1a, M4; mutation: drop the prefixes -> duplicate ids, FAILS)", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain(`>${m["record.skipToDetails"]}<`);
  });
  it("RecordHeader with every action, with none, and in the drawer's form (mutation: drop the no-action header -> 5 headers, FAILS)", () => {
    // Six headers: two in the layouts, one with every action, one with none, one whose subtitle
    // links to the group (S-03 part 2b), and the drawer's (S-03 part 3). Exactly one has no action row.
    expect(html.match(/data-record-header/g)).toHaveLength(6);
    expect(html.match(/data-record-actions/g)).toHaveLength(5);
  });
  it("a record header's subtitle can link to the group's own page (S-03 part 2b; mutation: drop subtitleHref -> FAILS)", () => {
    const start = html.indexOf("data-sg-header-linked");
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, start + 2000);
    expect(section).toMatch(/<a[^>]*data-record-subtitle[^>]*href="#"[^>]*>/);
  });
  it("RecordCard loading, ready, empty, error and closed on a phone (mutation: drop a state -> FAILS)", () => {
    for (const s of ["loading", "ready", "empty", "error"]) expect(html).toContain(`data-sg-record-card="${s}"`);
    expect(html).toContain('data-sg-record-card="closed"');
    expect(html).toContain('aria-expanded="false"');
  });
  it("AuthorMark in all five kinds and a TimelineItem with its skeleton (spec §15; mutation: drop the import mark -> FAILS)", () => {
    for (const kind of ["person", "ai", "automation", "customer", "import"]) expect(html).toContain(`data-author-mark="${kind}"`);
    expect(html).toContain(`>${m["provenance.customer"]}<`);
    expect(html).toContain('data-timeline-item="booking"');
    expect(html).toContain("data-timeline-skeleton");
  });
  it("a timeline row can name the member it is about (S-03 part 2b; mutation: drop the subject -> FAILS)", () => {
    expect(html).toMatch(/<a[^>]*data-timeline-subject[^>]*>Dan López<\/a>/);
  });

  it("the drawer's header and its flat sections in a Sheet's surface (S-03 part 3; mutation: drop the specimen -> FAILS)", () => {
    const start = html.indexOf("data-sg-drawer");
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf("data-sg-drawer-end"));
    expect(section).toMatch(/class="[^"]*glass-overlay/);
    expect(section).toContain("<h2");
    expect(section).not.toContain("<h1");
    expect(section).not.toContain(`>${m["record.back"]}<`);
    expect(section).toContain(`aria-label="${m["drawer.openFull"]}"`);
    expect([...section.matchAll(/data-record-section="[^"]+" data-state="(\w+)"/g)].map((x) => x[1]))
      .toEqual(["ready", "loading", "empty", "error"]);
  });

  it("the AI part's five states (DoD: /styleguide; spec 4.8; mutation: drop one state -> FAILS)", () => {
    const start = html.indexOf("data-sg-ai-summary");
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf("data-sg-ai-summary-end"));
    for (const s of ["loading", "ready", "capped", "failed"]) expect(section).toContain(`data-state="${s}"`);
    expect(section).toContain("data-sg-ai-none");
  });
});
