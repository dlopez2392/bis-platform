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
  it("RecordHeader with every action and with none (mutation: drop the no-action header -> 3 headers, FAILS)", () => {
    // Each of the two layouts carries its own header with every action, so the page has four
    // headers: two in the layouts, then one with every action and one with none. Exactly one of
    // the four has no action row.
    expect(html.match(/data-record-header/g)).toHaveLength(4);
    expect(html.match(/data-record-actions/g)).toHaveLength(3);
  });
  it("RecordCard loading, ready, empty, error and closed on a phone (mutation: drop a state -> FAILS)", () => {
    for (const s of ["loading", "ready", "empty", "error"]) expect(html).toContain(`data-sg-record-card="${s}"`);
    expect(html).toContain('data-sg-record-card="closed"');
    expect(html).toContain('aria-expanded="false"');
  });
});
