import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The error specimens render Retry, which refreshes through the app router a static render has not mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { WorkTrayDemo } = await import("./work-tray-demo");

/**
 * The To do tray's grouped cards, "Waiting for you" in all five states, and the agency Work page's
 * per-account cards (item 8b-2, Task 7), in English, Spanish and the pseudo-locale, built from the real
 * `groupSuggestions`/`buildSuggestionView` over `suggestion-specimens.ts`'s typed-out rows — this page
 * cannot drift from the real tray. One specimen (`rows.cited`) carries an `evidenceRef`, so its card's
 * transcript link renders here too.
 */
describe("styleguide: the work tray (grouped cards, Waiting for you, the agency section)", () => {
  // No props (final review I-1): the server page cannot hand a client component the columns, which hold
  // functions; the demo builds them itself.
  const html = () => renderToStaticMarkup(createElement(WorkTrayDemo));

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

// Design review minor 4: the error states of Waiting for you and of the agency section are specimens too,
// and three locale columns on one page never share an id (aria-labelledby would point at the first copy).
describe("styleguide: the work tray's error states and ids (design review minor 4)", () => {
  const html = () => renderToStaticMarkup(createElement(WorkTrayDemo));

  it("Waiting for you and the agency section each show their error line with Retry, per locale (mutation: drop the {ok:false} specimens -> FAILS)", () => {
    const h = html();
    for (const key of ["en", "es", "pseudo"]) {
      expect(h).toContain(`data-sg-waiting-error="${key}"`);
      expect(h).toContain(`data-sg-agency-error="${key}"`);
    }
    const en = h.slice(h.indexOf('data-sg-waiting-error="en"'));
    expect(en).toMatch(/^[^]*?<div role="alert"[^>]*>[^]*?Couldn&#x27;t load suggestions\.[^]*?<button[^>]*>Retry<\/button>/);
    const es = h.slice(h.indexOf('data-sg-agency-error="es"'));
    expect(es).toMatch(/^[^]*?<h2[^>]*>Sugerencias<\/h2>[^]*?No se pudieron cargar las sugerencias\./);
  });

  it("no id appears twice on the page, and every aria-labelledby names one that exists (mutation: a fixed headingId -> FAILS)", () => {
    const h = html();
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]!);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    for (const x of h.matchAll(/aria-labelledby="([^"]+)"/g)) expect(ids).toContain(x[1]);
  });
});
