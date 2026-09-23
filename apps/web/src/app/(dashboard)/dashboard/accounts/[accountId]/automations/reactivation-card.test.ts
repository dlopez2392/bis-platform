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
 * postal address and a reply-to — the save refuses to turn it on, the
 * due-list walk leaves the account out and the pass skips every row — so the
 * card says so up front, names WHICH is missing, and links to where it is
 * fixed.
 *
 * HOW LOUDLY depends on the STORED `enabled` (review minor M3, 2026-09-22),
 * never the unsaved checkbox: amber is for something configured that is
 * broken. Recipe ON and missing → the app's one status banner (`Notice`,
 * role="alert"), because check-ins that should be going are not. Recipe OFF
 * (or never saved) and missing → a muted line saying what is needed before it
 * can be turned on; nothing is broken yet, and every account starts here.
 * Both carry `data-testid="reactivation-missing"`.
 *
 * THE LINK GOES TO SETTINGS (review minor M5): this page is agency-only, and
 * the agency edits branding on Settings (settings/page.tsx renders the
 * BrandingPanel). The palette registry has no branding anchor on that page,
 * so the link carries none.
 */
describe("the reactivation card — what it cannot send without", () => {
  /** React's own text escaping, so a catalogue string can be found in markup. */
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  type LinkedKey =
    | "automations.reactivation.missingBoth" | "automations.reactivation.missingMailingAddress"
    | "automations.reactivation.missingReplyTo"
    | "automations.reactivation.beforeOnBoth" | "automations.reactivation.beforeOnMailingAddress"
    | "automations.reactivation.beforeOnReplyTo";
  const parts = (key: LinkedKey) => m[key].split("{settingsLink}").map(esc);
  const SETTINGS_LINK = `href="/dashboard/accounts/a1/settings"`;
  const OFF: (AutomationRow | null)[] = [{ ...ROW, enabled: false }, null];

  it("with both set there is NO warning and no line, recipe on or off", () => {
    for (const automation of [ROW, ...OFF]) {
      const html = render({ automation });
      expect(html).not.toContain(`data-testid="reactivation-missing"`);
      expect(html).not.toContain(`role="alert"`);
    }
  });

  it("recipe ON, no mailing address → a warn Notice that says so and links to Settings", () => {
    // Mutation: drop the mailing-address arm (render nothing for it) → this
    // reds BY NAME. Mutation: point the link back at `/branding` → this reds.
    const html = render({ missing: { mailingAddress: true, replyTo: false } });
    expect(html).toContain(`data-testid="reactivation-missing"`);
    expect(html).toContain(`role="alert"`);
    expect(html).toContain("bg-[var(--warn-bg)]");
    for (const p of parts("automations.reactivation.missingMailingAddress")) expect(html).toContain(p);
    expect(html).toContain(SETTINGS_LINK);
    expect(html).toContain(`>${m["nav.settings"]}</a>`);
    expect(html).not.toContain(`/branding"`);
  });

  it("recipe ON, no reply-to → a warn Notice that says so and links to Settings", () => {
    // Mutation: drop the reply-to arm → this reds BY NAME.
    const html = render({ missing: { mailingAddress: false, replyTo: true } });
    expect(html).toContain(`data-testid="reactivation-missing"`);
    expect(html).toContain(`role="alert"`);
    for (const p of parts("automations.reactivation.missingReplyTo")) expect(html).toContain(p);
    expect(html).toContain(SETTINGS_LINK);
  });

  it("recipe ON, both missing → ONE Notice naming both, not two", () => {
    // Mutation: render the two single-field Notices instead → this reds.
    const html = render({ missing: { mailingAddress: true, replyTo: true } });
    for (const p of parts("automations.reactivation.missingBoth")) expect(html).toContain(p);
    expect(html.split(`data-testid="reactivation-missing"`).length - 1).toBe(1);
  });

  it("recipe OFF or never saved → a MUTED line, not a warning: what is needed before it can be turned on, linked to Settings", () => {
    // Mutation: render the warn Notice whatever the stored setting (the shape
    // before M3) → this reds BY NAME on `role="alert"`.
    const cases = [
      [{ mailingAddress: true, replyTo: false }, "automations.reactivation.beforeOnMailingAddress"],
      [{ mailingAddress: false, replyTo: true }, "automations.reactivation.beforeOnReplyTo"],
      [{ mailingAddress: true, replyTo: true }, "automations.reactivation.beforeOnBoth"],
    ] as const;
    for (const automation of OFF) {
      for (const [missing, key] of cases) {
        const html = render({ automation, missing });
        const label = `${automation === null ? "never saved" : "off"}: ${key}`;
        expect(html, label).toContain(`<p class="text-xs text-muted-foreground" data-testid="reactivation-missing">`);
        expect(html.split(`data-testid="reactivation-missing"`).length - 1, label).toBe(1);
        expect(html, label).not.toContain(`role="alert"`);
        expect(html, label).not.toContain("bg-[var(--warn-bg)]");
        for (const p of parts(key)) expect(html, label).toContain(p);
        expect(html, label).toContain(SETTINGS_LINK);
        expect(html, label).toContain(`>${m["nav.settings"]}</a>`);
      }
    }
  });

  it("recipe ON → never the muted line: the amber Notice is keyed on the STORED setting", () => {
    // Mutation: render the muted line whatever the stored setting → this
    // reds BY NAME. (The unsaved checkbox cannot reach this: the card reads
    // `automation.enabled`, the row as saved.)
    for (const missing of [
      { mailingAddress: true, replyTo: false }, { mailingAddress: false, replyTo: true },
      { mailingAddress: true, replyTo: true },
    ]) {
      const html = render({ missing });
      expect(html, JSON.stringify(missing)).toContain(`role="alert"`);
      expect(html, JSON.stringify(missing))
        .not.toContain(`<p class="text-xs text-muted-foreground" data-testid="reactivation-missing">`);
    }
  });
});
