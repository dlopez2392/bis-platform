import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";
import { m } from "@/lib/messages";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { NoShowNudgeCard } from "./no-show-nudge-card";

/**
 * THE NO-SHOW COUNTER MUST COUNT WHAT IS BILLED.
 *
 * `sendAutomationSms` appends the opt-out disclosure unconditionally
 * (send-sms.ts:82), and the pass hands it no `language`
 * (passes/no-show-nudge.ts:218-222), so every nudge ends in " Reply STOP to
 * opt out." — 23 septets the card did not count until decision B (danlo,
 * 2026-09-22). referral-ask-card.test.ts is the template this file follows.
 */
// A REAL booking link's shape: APP_ORIGIN (.env.example) + `/b/` + a
// 12-character id from forms.ts's ALPHABET — 38 characters.
const BOOKING_URL = "https://app.bis-rgv.com/b/k7m2p9q4x3wz";

const ROW: AutomationRow = {
  id: "au2", account_id: "a1", recipe_key: "no_show_nudge", enabled: true,
  body: "", config: { channel: "sms" }, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof NoShowNudgeCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(NoShowNudgeCard, {
    automation: ROW, brandName: "Rio Roofing",
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    bookingUrl: BOOKING_URL, calendarEnabled: true,
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

/** The counter's text, and only its text — the `</p>` proves the opt-out
 *  note is not inside this paragraph. */
function countText(html: string): string {
  const found = /data-testid="no-show-sms-count">([^<]*)<\/p>/.exec(html);
  if (!found) throw new Error("the segment counter did not render as one clean paragraph");
  return found[1]!.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&#xB7;|&middot;/g, "·");
}

describe("the no-show nudge card's segment counter", () => {
  it("MEASURED: counts the DISCLOSED text — 135 characters, not the 112 the composed body alone would show", () => {
    // Measured with segmentsFor/withOptOut/composeNoShowNudgeSms: the default
    // for "Rio Roofing" plus the 38-character booking link is 112 septets
    // composed, 135 disclosed — ONE segment. Mutation: count
    // `composeNoShowNudgeSms(...)` without `withOptOut` → this reds BY NAME.
    expect(countText(render())).toBe("135 characters · 1 message(s)");
  });

  it("MEASURED: \"Valley Air Conditioning\" is ONE message disclosed — the ledger's case, no longer billed twice", () => {
    // Under the old default this name was 148 composed and 171 disclosed, TWO
    // billed messages. With the shorter default it is 124 → 147, one.
    // Mutation: restore the old default → this reds.
    expect(countText(render({ brandName: "Valley Air Conditioning" }))).toBe("147 characters · 1 message(s)");
  });

  it("MEASURED: a 39-character name shows ONE message undisclosed and bills TWO", () => {
    // "Valley Air Conditioning and Heating LLC" (39): 140 septets composed
    // (one segment), 163 disclosed (two). On this link the default holds a
    // GSM-7 name of 36 characters or fewer. Mutation: drop `withOptOut` →
    // this reds on the MESSAGE COUNT, not merely on the character count.
    expect(countText(render({ brandName: "Valley Air Conditioning and Heating LLC" })))
      .toBe("163 characters · 2 message(s)");
  });

  it("says out loud that the count includes the opt-out sentence, and only on the text channel", () => {
    // The 23 septets counted appear nowhere else on the page. Its own
    // paragraph; an emailed nudge has no opt-out sentence and no count.
    // Mutation: delete the note → the first line reds; move it out of the
    // `channel === "sms"` branch → the email half reds.
    expect(render()).toContain(m["automations.optOutCounted"]);
    const email = render({ automation: { ...ROW, config: { channel: "email" } } });
    expect(email).not.toContain('data-testid="no-show-sms-count"');
    expect(email).not.toContain(m["automations.optOutCounted"]);
  });
});
