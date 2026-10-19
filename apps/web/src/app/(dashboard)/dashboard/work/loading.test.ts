import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Loading from "./loading";

/** The agency Work page while it loads (rule 7): the bucket skeleton, then the suggestions' card skeleton,
 *  grouped as the loaded section is (item 8b-2), inside the one aria-busy region, never a spinner. */
describe("the agency Work page's loading skeleton", () => {
  it("carries the grouped suggestions skeleton after the bucket's, inside aria-busy (mutation: drop it -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    const busy = html.slice(html.indexOf('aria-busy="true"'));
    expect((busy.match(/data-skeleton=/g) ?? []).length).toBe(2);
    expect(busy).toContain("data-tray-group-bar");
    expect(busy.indexOf("rounded-xl border border-border")).toBeLessThan(busy.indexOf("data-skeleton="));
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });
});
