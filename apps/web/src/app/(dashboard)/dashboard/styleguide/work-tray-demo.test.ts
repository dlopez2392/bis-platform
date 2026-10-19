import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildWorkTrayColumns, WorkTrayDemo } from "./work-tray-demo";

/**
 * The To do tray's grouped cards, "Waiting for you" in all five states, and the agency Work page's
 * per-account cards (item 8b-2, Task 7), in English, Spanish and the pseudo-locale, built from the real
 * `groupSuggestions`/`buildSuggestionView` over `suggestion-specimens.ts`'s typed-out rows — this page
 * cannot drift from the real tray. One specimen (`rows.cited`) carries an `evidenceRef`, so its card's
 * transcript link renders here too.
 */
describe("styleguide: the work tray (grouped cards, Waiting for you, the agency section)", () => {
  const html = () => renderToStaticMarkup(createElement(WorkTrayDemo, { columns: buildWorkTrayColumns() }));

  it("one column per locale", () => {
    const h = html();
    for (const key of ["en", "es", "pseudo"]) {
      expect(h).toContain(`data-sg-work-tray="${key}"`);
    }
  });

  it("Waiting for you shows a flat row in each of the five states, per locale", () => {
    const h = html();
    for (const key of ["en", "es", "pseudo"]) {
      const col = h.split(`data-sg-waiting="${key}"`)[1] ?? "";
      const chunk = col.slice(0, col.indexOf("data-waiting-skeleton"));
      expect([...chunk.matchAll(/<li[^>]*data-status="([a-z]+)"/g)].map((x) => x[1]))
        .toEqual(["pending", "accepted", "edited", "dismissed", "expired"]);
    }
  });

  /** The `data-sg-*` marker's own section, up to the next marker — never the rest of the page. */
  function section(h: string, marker: string): string {
    const start = h.indexOf(marker);
    const rest = h.slice(start);
    const next = rest.slice(1).search(/data-sg-(waiting|tray-grouped|agency|work-tray)=/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  }

  it("the grouped tray specimen: two mono-label group headings, newest first, each over its own card", () => {
    const h = html();
    const col = section(h, 'data-sg-tray-grouped="en"');
    const heads = [...col.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((x) => x[1]);
    expect(heads).toEqual(["Ana López · from the call on Wed, Oct 14", "No customer yet · from the call on Wed, Oct 14"]);
    expect(col).toMatch(/Ana López[^<]*<\/h3><article[^>]*data-suggestion="sg_pending"/);
    expect(col).toMatch(/No customer yet[^<]*<\/h3><article[^>]*data-suggestion="sg_cited"/);
  });

  it("the cited card's transcript link renders, with the time since the call began", () => {
    const h = html();
    const col = section(h, 'data-sg-tray-grouped="en"');
    expect(col).toContain('href="/dashboard/accounts/acc_1/calls/call_1#turn-4"');
    expect(col).toMatch(/See it in the transcript[^<]*2:14/);
  });

  it("the agency section: one capped account and one not, each with its own brand name and cap line", () => {
    const h = html();
    const col = section(h, 'data-sg-agency="en"');
    expect(col).toContain("Acme HVAC");
    expect(col).toContain("Rio Roofing");
    expect(col).toContain("Showing the newest 50 for this account.");
  });

  it("Spanish and the pseudo-locale render their own words, not English's", () => {
    const h = html();
    expect(h).toContain("Esperan su respuesta");
    expect(h).toContain("Se muestran las 50 más recientes de esta cuenta");
    expect(h).toMatch(/\[Sú/);
  });
});
