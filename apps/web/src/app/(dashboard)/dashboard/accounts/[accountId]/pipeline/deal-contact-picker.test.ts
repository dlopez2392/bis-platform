import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DealContactHit, DealContactPicker, dealContactSearchUrl, nextHitIndex, dealSubmitBlock,
} from "./deal-contact-picker";

/**
 * The new-deal picker (F-092 out-of-scope finding, pipeline/page.tsx:26): it offered only the newest 200
 * contacts in a plain dropdown, so on any account past 200 people the customer a deal was for could not be
 * chosen at all. It is now the search-as-you-type picker the Add job sheet uses: the palette's search route,
 * contacts only, the matched letters set apart. No DOM renderer in apps/web, so the parts are tested from
 * props and the server render (job-sheet's JobSearchHit idiom).
 */
const ACCT = "11111111-1111-4111-8111-111111111111";

describe("dealContactSearchUrl", () => {
  it("asks the account's search route for contacts only, the term encoded (mutation: drop types=contacts -> FAILS)", () => {
    expect(dealContactSearchUrl(ACCT, "Ana & Co")).toBe(`/api/accounts/${ACCT}/search?q=Ana%20%26%20Co&types=contacts`);
  });
});

describe("DealContactHit", () => {
  const hit = { id: "c1", label: "Ana García", sublabel: "(956) 555-0123", at: null, href: "/x" };

  it("draws the name and the phone with the matched letters marked, as a button that chooses (mutation: plain text -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealContactHit, { hit, query: "ana", onChoose: () => {}, index: 0, onKey: () => {} }));
    expect(html).toContain('data-deal-hit="c1"');
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<mark[^>]*data-search-hit[^>]*>Ana<\/mark>/);
    expect(html).toContain("(956) 555-0123");
  });

  it("never marks letters inside the route's stand-in for a contact with no name", () => {
    const html = renderToStaticMarkup(createElement(DealContactHit, {
      hit: { id: "c2", label: "Unnamed contact", sublabel: null, unnamed: true as const, at: null, href: "/x" }, query: "un", onChoose: () => {}, index: 0, onKey: () => {},
    }));
    expect(html).not.toContain("data-search-hit");
  });
});

describe("DealContactPicker — before anyone is chosen", () => {
  const html = renderToStaticMarkup(createElement(DealContactPicker, { accountId: ACCT, labelId: "deal-contact" }));

  it("is a search box, not a dropdown of the newest few (mutation: keep the Select -> FAILS)", () => {
    expect(html).toMatch(/<input[^>]*type="search"/);
    expect(html).toContain('aria-labelledby="deal-contact"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="combobox"');
  });

  it("carries the chosen id in the form as contactId, empty until someone is chosen", () => {
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="contactId"[^>]*value=""/);
  });

  it("announces results politely", () => {
    expect(html).toContain('aria-live="polite"');
  });
});

describe("nextHitIndex — the keyboard between the box and the results", () => {
  it("ArrowDown from the box goes to the first result, and on down the list, stopping at the last", () => {
    expect(nextHitIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextHitIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextHitIndex(2, "ArrowDown", 3)).toBe(2);
  });
  it("ArrowUp walks back, and from the first result returns to the box (-1)", () => {
    expect(nextHitIndex(2, "ArrowUp", 3)).toBe(1);
    expect(nextHitIndex(0, "ArrowUp", 3)).toBe(-1);
  });
  it("with no results, or another key, nothing moves (null)", () => {
    expect(nextHitIndex(-1, "ArrowDown", 0)).toBeNull();
    expect(nextHitIndex(0, "Enter", 3)).toBeNull();
  });
});

describe("dealSubmitBlock — a deal needs its customer", () => {
  it("names what is missing when no one was chosen, so the press says why instead of failing on the server", () => {
    const fd = new FormData();
    fd.set("contactId", "");
    expect(dealSubmitBlock(fd)).toBe("pipeline.contactRequired");
  });
  it("lets a chosen customer through", () => {
    const fd = new FormData();
    fd.set("contactId", "c1");
    expect(dealSubmitBlock(fd)).toBeNull();
  });
});
