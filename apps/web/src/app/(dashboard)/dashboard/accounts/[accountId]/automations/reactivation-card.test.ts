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
    automation: ROW, brandName: "Rio Roofing",
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
