import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { renderedText } from "./rendered-text";

/**
 * This helper is load-bearing for a whole class of NEGATIVE assertions
 * across five spec files, and a negative that stops working fails SILENTLY —
 * it just goes green forever. So the helper itself needs pinning.
 *
 * The assertions below are written against React's ACTUAL output rather than
 * hand-typed entity strings, because the thing being guarded is "whatever
 * React really emits survives the round trip", not "this table of entities is
 * correct".
 */
describe("renderedText — the apostrophe trap", () => {
  it("recovers copy React escaped (mutation: drop the &#x27; replace -> FAILS)", () => {
    const copy = "This company has no timezone of its own, so times use the agency's.";
    const html = renderToStaticMarkup(createElement("p", null, copy));

    // The trap, stated as an assertion: the raw markup does NOT contain the
    // copy, which is why `expect(html).toContain(copy)` silently covers
    // nothing and `expect(html).not.toContain(copy)` can never fail.
    expect(html).not.toContain(copy);
    // …and the helper is what makes both directions meaningful again.
    expect(renderedText(html)).toContain(copy);
  });

  it("recovers a contraction too (mutation: as above -> FAILS)", () => {
    const copy = "Your timezone isn't set yet.";
    const html = renderToStaticMarkup(createElement("p", null, copy));
    expect(renderedText(html)).toContain(copy);
  });

  it("strips tags so text assertions cannot match a class name or an href", () => {
    const html = renderToStaticMarkup(
      createElement("a", { href: "/dashboard/accounts/x/settings", className: "underline" }, "Set it in Settings"),
    );
    expect(renderedText(html)).toContain("Set it in Settings");
    expect(renderedText(html)).not.toContain("underline");
    expect(renderedText(html)).not.toContain("/settings");
  });

  it("decodes the ampersand LAST (mutation: move the &amp; replace first -> FAILS)", () => {
    // Two passes over "&amp;#x27;" would collapse it into a real apostrophe,
    // inventing text the page never rendered. Ordering is load-bearing, so it
    // is asserted rather than left to the comment beside it.
    expect(renderedText("&amp;#x27;")).toBe("&#x27;");
  });

  it("leaves ordinary text untouched", () => {
    expect(renderedText("Times shown in America/Chicago")).toBe("Times shown in America/Chicago");
  });
});
