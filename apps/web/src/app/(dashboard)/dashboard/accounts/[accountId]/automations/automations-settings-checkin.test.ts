import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";
import { m } from "@/lib/messages";

vi.mock("sonner", () => ({ toast: {} }));

import { AutomationsSettings, ReviewMessageFields } from "./automations-settings";
import { CheckinCountsView, CheckinCountsSkeleton } from "./checkin-counts";

/**
 * F-072 PR 4 (plan D5, D8): the Review requests card's check-in switch, "Open link", the message box that steps
 * aside while the switch is on, and the counts line's four states. Rendered with the card's own harness
 * (automations-settings.test.ts): renderToStaticMarkup, no browser.
 */
const LINK = "https://g.page/r/CXyZ123abc/review";
const ROW = (config: Record<string, unknown>, over: Partial<AutomationRow> = {}): AutomationRow => ({
  id: "au1", account_id: "a1", recipe_key: "review_request", enabled: true,
  body: "Thanks, come again!", body_es: null, body_es_basis: null, config,
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z", ...over,
});
function render(over: Partial<Parameters<typeof AutomationsSettings>[0]> = {}): string {
  return renderToStaticMarkup(createElement(AutomationsSettings, {
    automation: ROW({ channel: "email", reviewUrl: LINK }), brandName: "Rio Roofing",
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}
const html = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the check-in switch (plan D5)", () => {
  it("is in the card's own form, named for the save, labelled, off for a row stored without it (mutation: render outside the form -> FAILS)", () => {
    const out = render();
    expect(out).toContain('id="review-checkin"');    expect(out).toContain('name="checkin"');
    expect(html(out)).toContain(m["automations.review.checkin.label"]);
    expect(out.indexOf('id="review-checkin"')).toBeGreaterThan(out.indexOf("<form"));
    expect(out.indexOf('id="review-checkin"')).toBeLessThan(out.indexOf("</form>"));
    expect(/id="review-checkin"[^>]*aria-checked="false"/.test(out) || /aria-checked="false"[^>]*id="review-checkin"/.test(out)).toBe(true);
  });

  it("reads checked from a stored checkin: true, and only the boolean true (mutation: truthy read -> a stored 'true' string shows on, FAILS)", () => {
    const on = render({ automation: ROW({ channel: "email", reviewUrl: LINK, checkin: true }) });
    expect(/id="review-checkin"[^>]*aria-checked="true"/.test(on) || /aria-checked="true"[^>]*id="review-checkin"/.test(on)).toBe(true);
    for (const stored of ["true", 1, false]) {
      const out = render({ automation: ROW({ channel: "email", reviewUrl: LINK, checkin: stored }) });
      expect(/id="review-checkin"[^>]*aria-checked="true"/.test(out) || /aria-checked="true"[^>]*id="review-checkin"/.test(out), String(stored)).toBe(false);
    }
  });

  it("is hidden when Text is the channel, with the card's one primary Save untouched (mutation: show it on every channel -> FAILS)", () => {
    const sms = render({ automation: ROW({ channel: "sms", reviewUrl: LINK }) });
    expect(sms).not.toContain('id="review-checkin"');
    expect(html(sms)).not.toContain(m["automations.review.checkin.label"]);
    expect((render().match(/data-variant="default"/g) ?? []).length).toBe(1);
  });

  it("a stored checkin on a Text row does not show as on or submit (a text cannot carry it)", () => {
    const out = render({ automation: ROW({ channel: "sms", reviewUrl: LINK, checkin: true }) });
    expect(out).not.toContain('name="checkin"');
    // The Text channel's own message box stays visible: the check-in is not in play.
    expect(isHidden(out)).toBe(false);
  });
});

/** The `hidden` attribute on the message-fields element ITSELF (not a class, not a neighbour's attribute). */
const fieldsTag = (out: string) => /<div\b[^>]*data-testid="review-message-fields"[^>]*>/.exec(out)?.[0] ?? null;
function isHidden(out: string): boolean { return /\shidden(=""|\s|>)/.test(fieldsTag(out) ?? ""); }

describe("the message box while the switch is on (plan D5)", () => {
  it("steps aside (hidden attribute on its own element) but stays in the form, so the typed text still submits (mutation: unmount it -> FAILS)", () => {
    const on = render({ automation: ROW({ channel: "email", reviewUrl: LINK, checkin: true }) });
    expect(fieldsTag(on)).not.toBeNull();
    expect(isHidden(on)).toBe(true);
    expect(on).toContain('name="body"');
    expect(on).toContain("Thanks, come again!");
    expect(on.indexOf('name="body"')).toBeLessThan(on.indexOf("</form>"));
    expect(html(on)).toContain(m["automations.review.checkin.hint"]);
  });

  it("is visible with the switch off (mutation: hide it always -> FAILS)", () => {
    const off = render();
    expect(fieldsTag(off)).not.toBeNull();
    expect(isHidden(off)).toBe(false);
    expect(off).toContain('name="body"');
  });

  // The card's channel is client state a static render cannot change, so the rule lives in ReviewMessageFields, which
  // the card renders with its own live `checkin` and `channel`; this drives it with every pair.
  it("Email with the switch on is hidden; switch the channel to Text and it is visible again (mutation: drop the channel check -> FAILS)", () => {
    const at = (checkin: boolean, channel: "email" | "sms") =>
      renderToStaticMarkup(createElement(ReviewMessageFields, { checkin, channel }, createElement("span", null, "x")));
    expect(isHidden(at(true, "email"))).toBe(true);
    expect(isHidden(at(true, "sms"))).toBe(false);
    expect(isHidden(at(false, "email"))).toBe(false);
    expect(isHidden(at(false, "sms"))).toBe(false);
  });
});

describe("Open link (plan D5)", () => {
  const anchor = (out: string) => /<a [^>]*data-testid="review-open-link"[^>]*>/.exec(out)?.[0] ?? null;

  it("opens the stored link in a new tab, safely, with no server call (target=_blank, rel=noopener noreferrer; mutation: drop rel -> FAILS)", () => {
    const a = anchor(render())!;
    expect(a).not.toBeNull();
    expect(a).toContain(`href="${LINK}"`);
    expect(a).toContain('target="_blank"');
    expect(a).toContain('rel="noopener noreferrer"');
    expect(html(render())).toContain(m["automations.review.openLink"]);
  });

  it("says it opens in a new tab in text a screen reader reads, not only in a title (mutation: drop the hidden text -> FAILS)", () => {
    const out = html(render());
    expect(/<span class="sr-only">[^<]*<\/span>/.exec(out)?.[0]).toContain(m["automations.review.openLinkNewTab"]);
  });

  it("is not drawn without a link, or for a link that is not http(s): never a javascript: href (mutation: href=raw value -> FAILS)", () => {
    for (const url of ["", "   ", "javascript:alert(1)", "not a url", "data:text/html,x"]) {
      expect(anchor(render({ automation: ROW({ channel: "email", reviewUrl: url }) })), JSON.stringify(url)).toBeNull();
    }
  });

  it("opens the normalised address, as the pass would send it (a bare origin gains its slash)", () => {
    const a = anchor(render({ automation: ROW({ channel: "email", reviewUrl: "https://x.example" }) }))!;
    expect(a).toContain('href="https://x.example/"');
  });
});

describe("the counts line (plan D8): loading, empty, loaded, error", () => {
  const view = (state: Parameters<typeof CheckinCountsView>[0]["state"]) => html(renderToStaticMarkup(createElement(CheckinCountsView, { state })));
  const ZERO = { asked: 0, answered: 0, great: 0, okay: 0, notGreat: 0, opened: 0 };

  it("loaded: the numbers, in words, with the one honest caveat about 'opened'", () => {
    const out = view({ kind: "loaded", counts: { asked: 9, answered: 6, great: 3, okay: 2, notGreat: 1, opened: 4 } });
    expect(out).toContain("9 asked, 6 answered (3 great, 2 okay, 1 not great). 4 opened the review link.");
    expect(out).toContain(m["automations.review.counts.note"]);
    expect(out).not.toContain("{");
  });

  it("empty: nothing sent yet says what will appear here, not a row of zeros (mutation: render zeros -> FAILS)", () => {
    const out = view({ kind: "loaded", counts: ZERO });
    expect(out).toContain(m["automations.review.counts.empty"]);
    expect(out).not.toContain("0 asked");
  });

  it("asked but unanswered is NOT empty: the zeros are a fact worth showing", () => {
    expect(view({ kind: "loaded", counts: { ...ZERO, asked: 3 } })).toContain("3 asked, 0 answered");
  });

  it("error: says it could not load, never zeros (mutation: show zeros on failure -> FAILS)", () => {
    const out = view({ kind: "error" });
    expect(out).toContain(m["automations.review.counts.error"]);
    expect(out).not.toContain("asked");
  });

  it("loading: a skeleton shaped like the line, no spinner, and the same title", () => {
    const out = renderToStaticMarkup(createElement(CheckinCountsSkeleton));
    expect(out).toContain('data-slot="skeleton"');
    expect(out).toContain('data-testid="review-checkin-counts-loading"');
    expect(out).not.toMatch(/spin/);
    expect(html(out)).toContain(m["automations.review.counts.title"]);
  });

  const slot = createElement("p", { "data-testid": "slot" }, "COUNTS-HERE");

  it("the card draws the counts the page hands it, under the form, when the check-in is on and the channel is Email", () => {
    const out = render({ automation: ROW({ channel: "email", reviewUrl: LINK, checkin: true }), counts: slot });
    expect(out).toContain("COUNTS-HERE");
    expect(out.indexOf("COUNTS-HERE")).toBeGreaterThan(out.indexOf("</form>"));
  });

  it("draws NO counts for a stored checkin that is false or absent, nor for Text: no false 'no check-ins yet' on an account that never had one (mutation: always draw -> FAILS)", () => {
    for (const config of [{ channel: "email", reviewUrl: LINK }, { channel: "email", reviewUrl: LINK, checkin: false },
      { channel: "sms", reviewUrl: LINK }, { channel: "sms", reviewUrl: LINK, checkin: true }]) {
      expect(render({ automation: ROW(config), counts: slot }), JSON.stringify(config)).not.toContain("COUNTS-HERE");
    }
    expect(render({ automation: null, counts: slot })).not.toContain("COUNTS-HERE");
  });

  it("says 'asked' counts every review ask in the window, so it can include asks from before the switch (plan D8)", () => {
    const out = view({ kind: "loaded", counts: { asked: 9, answered: 6, great: 3, okay: 2, notGreat: 1, opened: 4 } });
    expect(out).toContain(m["automations.review.counts.askedNote"]);
    expect(m["automations.review.counts.askedNote"]).toMatch(/before/);
  });
});
