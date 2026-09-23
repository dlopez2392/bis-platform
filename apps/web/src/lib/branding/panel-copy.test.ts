import { describe, expect, it } from "vitest";
import { m } from "@/lib/messages";
import { panelCopy } from "./panel-copy";

/**
 * The defect this file exists to stop, and it was found by LOOKING at the page
 * — no gate could see it.
 *
 * M4c gave clients their own Branding page and correctly gave the card its own
 * heading and body, then left every field hint in the agency's voice. A client
 * opening the page built for them read that the colour applies to "their lead
 * forms and their sidebar" (meaning their own), that the greys sit behind
 * "their content", and — worst — that "your internal name for them stays
 * private", which describes a thing only the agency has.
 *
 * `them` is included because it is the tell for the same slip in the other
 * direction ("shown to them"). It does not match "themselves".
 */
const THIRD_PERSON = [/\btheir\b/i, /\bthey\b/i, /\bthem\b/i, /this company/i, /internal name/i];

describe("panelCopy", () => {
  it("covers exactly the same keys for both audiences", () => {
    // An exact set, not a count: the way this regresses is a new hint being
    // added to one audience and forgotten on the other, and two opposite
    // mistakes cancel under a count.
    expect(Object.keys(panelCopy("client")).sort())
      .toEqual(Object.keys(panelCopy("agency")).sort());
  });

  it("never refers to the reader in the third person on the client's own page", () => {
    for (const [key, value] of Object.entries(panelCopy("client"))) {
      for (const marker of THIRD_PERSON) {
        expect(value, `client copy "${key}" must address the reader directly: ${value}`)
          .not.toMatch(marker);
      }
    }
  });

  /**
   * The agency's wording is deliberately untouched — Settings must render
   * byte-identically to before. Pinned here so a future "let's just reword it
   * once for everyone" is a failing test rather than a silent change to a
   * screen this work never looked at.
   */
  it("leaves the agency's wording alone", () => {
    const agency = panelCopy("agency");
    expect(agency.title).toBe(m["branding.title"]);
    expect(agency.description).toBe(m["branding.body"]);
    expect(agency.nameHint).toBe(m["branding.nameHint"]);
    expect(agency.colorHint).toBe(m["branding.colorHint"]);
    expect(agency.neutralHint).toBe(m["branding.neutralHint"]);
    expect(agency.modeHint).toBe(m["branding.modeHint"]);
    expect(agency.modeFollow).toBe(m["branding.modeFollow"]);
    expect(agency.mailingAddressHint).toBe(m["branding.mailingAddressHint"]);
  });
});
