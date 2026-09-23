import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS, REACTIVATION_DEFAULT_MONTHS,
  type AutomationRow,
} from "@bis/db";
import { m } from "@/lib/messages";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { ReactivationCard } from "./reactivation-card";

/**
 * Two things this card has to get right that no other test can see.
 *
 * 1. THE NUMBER BOX IS BUILT FROM THE CONSTANTS. The assertions below are
 *    built from the SAME constants, which is deliberate and not vacuous: the
 *    failure this catches is a HARD-CODED literal in the card, and a
 *    hard-coded `max={12}` reds the max assertion immediately. (An assertion
 *    built from the constant could not catch a change to the constant — but
 *    nothing is wrong when both move together, which is the whole point of
 *    reading it from one place.)
 * 2. THERE IS NO CHANNEL CONTROL. Email-only is the product refusing, not
 *    the card forgetting, and a select would offer a choice the pass cannot
 *    honour: the due-row carries no phone number at all.
 */
const ROW: AutomationRow = {
  id: "au7", account_id: "a1", recipe_key: "reactivation", enabled: true,
  body: "", config: { months: 14 }, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof ReactivationCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ReactivationCard, {
    automation: ROW, brandName: "Rio Roofing", accountId: "a1",
    missing: { mailingAddress: false, replyTo: false },
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

describe("the reactivation card", () => {
  it("bounds the months box with the parser's OWN constants, never a literal", () => {
    // Mutation: hard-code `max={12}` (or `min={1}`) in the card → this reds.
    const html = render();
    expect(html).toContain(`name="months"`);
    expect(html).toContain(`min="${REACTIVATION_MIN_MONTHS}"`);
    expect(html).toContain(`max="${REACTIVATION_MAX_MONTHS}"`);
    expect(html).toContain(`step="1"`);
  });

  it("shows the stored months, and the platform default when nothing is stored", () => {
    expect(render()).toContain(`value="14"`);
    // Mutation: default to the literal 9 instead of REACTIVATION_DEFAULT_MONTHS
    // → still green today, which is why the min/max case above is the guard;
    // this one exists so a stored value is never silently replaced.
    expect(render({ automation: null })).toContain(`value="${REACTIVATION_DEFAULT_MONTHS}"`);
  });

  it("offers NO channel control — email only is the product refusing, not the card forgetting", () => {
    // Mutation: add the referral ask's channel Select → this reds.
    const html = render();
    expect(html).not.toContain(`name="channel"`);
    expect(html.toLowerCase()).not.toContain(">text<");
    expect(html).toContain("Email only.");
  });

  it("always states the daily limit — a number never ships without its context (DESIGN.md rule 1)", () => {
    // Mutation: render the limit note only when the recipe is enabled → the
    // second line reds.
    for (const automation of [ROW, null, { ...ROW, enabled: false }]) {
      const html = render({ automation });
      expect(html).toContain(`data-testid="reactivation-limit-note"`);
      expect(html).toContain(m["automations.reactivation.limitNote"]);
    }
  });
});

/**
 * Decision A (2026-09-22): the check-in cannot go without the company's
 * postal address and a reply-to — the save refuses to turn it on and the
 * pass skips every row — so the card says so up front, names WHICH is
 * missing, and links to the page where it is fixed. A status the operator
 * must act on, so the app's one status banner (`Notice`, role="alert").
 */
describe("the reactivation card — what it cannot send without", () => {
  /** React's own text escaping, so a catalogue string can be found in markup. */
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const parts = (key: "automations.reactivation.missingBoth" | "automations.reactivation.missingMailingAddress"
    | "automations.reactivation.missingReplyTo") => m[key].split("{brandingLink}").map(esc);
  const BRANDING_LINK = `href="/dashboard/accounts/a1/branding"`;

  it("with both set there is NO warning", () => {
    const html = render();
    expect(html).not.toContain(`data-testid="reactivation-missing"`);
    expect(html).not.toContain(`role="alert"`);
  });

  it("no mailing address → a warn Notice that says so and links to Branding", () => {
    // Mutation: drop the mailing-address arm (render nothing for it) → this
    // reds BY NAME.
    const html = render({ missing: { mailingAddress: true, replyTo: false } });
    expect(html).toContain(`data-testid="reactivation-missing"`);
    expect(html).toContain(`role="alert"`);
    expect(html).toContain("bg-[var(--warn-bg)]");
    for (const p of parts("automations.reactivation.missingMailingAddress")) expect(html).toContain(p);
    expect(html).toContain(BRANDING_LINK);
    expect(html).toContain(`>${m["nav.branding"]}</a>`);
  });

  it("no reply-to → a warn Notice that says so and links to Branding", () => {
    // Mutation: drop the reply-to arm → this reds BY NAME.
    const html = render({ missing: { mailingAddress: false, replyTo: true } });
    expect(html).toContain(`data-testid="reactivation-missing"`);
    for (const p of parts("automations.reactivation.missingReplyTo")) expect(html).toContain(p);
    expect(html).toContain(BRANDING_LINK);
  });

  it("both missing → ONE Notice naming both, not two", () => {
    // Mutation: render the two single-field Notices instead → this reds.
    const html = render({ missing: { mailingAddress: true, replyTo: true } });
    for (const p of parts("automations.reactivation.missingBoth")) expect(html).toContain(p);
    expect(html.split(`data-testid="reactivation-missing"`).length - 1).toBe(1);
  });
});
