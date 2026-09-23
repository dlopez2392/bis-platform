import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";
import { m } from "@/lib/messages";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { AutomationsSettings } from "./automations-settings";

/**
 * THE REVIEW-REQUEST COUNTER MUST COUNT WHAT IS BILLED.
 *
 * `sendAutomationSms` appends the opt-out disclosure unconditionally
 * (send-sms.ts:82, `withOptOut(input.body, input.language)`), and the pass
 * hands it no `language` (passes/review-request.ts:235-239), so the text a
 * customer receives is the composed body PLUS " Reply STOP to opt out." — 23
 * septets the card did not count until decision B (danlo, 2026-09-22).
 * referral-ask-card.test.ts is the template this file follows.
 */
const SHORT_LINK = "https://g.page/r/CXyZ123abc/review";
// The other shape Google hands out for "ask for reviews", and the one an
// operator pastes from a browser: 79 characters. Its place id is Google's own
// documentation example, not a client's.
const LONG_LINK = "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

const ROW: AutomationRow = {
  id: "au1", account_id: "a1", recipe_key: "review_request", enabled: true,
  body: "", config: { channel: "sms", reviewUrl: SHORT_LINK },
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof AutomationsSettings>[0]> = {}): string {
  return renderToStaticMarkup(createElement(AutomationsSettings, {
    automation: ROW, brandName: "Rio Roofing",
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

/** The text of the counter paragraph, by its own testid — and ONLY its text:
 *  the closing `</p>` right after it is what proves the opt-out note sits in
 *  its own paragraph rather than inside this one. */
function countText(html: string): string {
  const found = /data-testid="review-sms-count">([^<]*)<\/p>/.exec(html);
  if (!found) throw new Error("the segment counter did not render as one clean paragraph");
  return found[1]!.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&#xB7;|&middot;/g, "·");
}

describe("the review-request card's segment counter", () => {
  it("MEASURED: counts the DISCLOSED text — 138 characters, not the 115 the composed body alone would show", () => {
    // Measured with segmentsFor/withOptOut/composeReviewRequestSms, never by
    // hand: the default body for "Rio Roofing" plus the short g.page link is
    // 115 septets composed; the disclosure adds 23 → 138, one segment.
    // Mutation: count `composeReviewRequestSms(...)` without `withOptOut` →
    // this reds BY NAME.
    expect(countText(render())).toBe("138 characters · 1 message(s)");
  });

  it("MEASURED: a pasted long review link puts the DISCLOSED text into a second segment the undisclosed one would hide", () => {
    // 160 septets composed (exactly the one-segment ceiling), 183 disclosed:
    // the undisclosed count said "1 message" and the client is billed for
    // two. The ledger's caveat, measured: the review request crosses on the
    // LINK, which the operator pastes, not on the company name — at the short
    // g.page link a GSM-7 name needs 34+ characters to cross (Rio Grande
    // Valley Roofing and Remodeling: 144 → 167). Mutation: drop `withOptOut`
    // → this reds on the MESSAGE COUNT, not merely the character count.
    const html = render({ automation: { ...ROW, config: { channel: "sms", reviewUrl: LONG_LINK } } });
    expect(countText(html)).toBe("183 characters · 2 message(s)");
  });

  it("does not double the disclosure when the operator's own message already says STOP", () => {
    // withOptOut is idempotent on `\bstop\b` (opt-out.ts:63). "Review us? Text
    // STOP to opt out." is 32 septets, plus one space and the 34-character
    // link = 67 (measured); a doubled disclosure would read 90.
    const html = render({ automation: { ...ROW, body: "Review us? Text STOP to opt out." } });
    expect(countText(html)).toBe("67 characters · 1 message(s)");
  });

  it("says out loud that the count includes the opt-out sentence, and only on the text channel", () => {
    // The 23 septets counted appear nowhere else on the page — the message
    // box shows the undisclosed default. Its own paragraph (countText's
    // `</p>` proves the counter stays one clean string). An emailed review
    // request has no opt-out sentence and no count.
    // Mutation: delete the note → the first line reds; move it out of the
    // `channel === "sms"` branch → the email half reds.
    expect(render()).toContain(m["automations.optOutCounted"]);
    const email = render({ automation: { ...ROW, config: { channel: "email", reviewUrl: SHORT_LINK } } });
    expect(email).not.toContain('data-testid="review-sms-count"');
    expect(email).not.toContain(m["automations.optOutCounted"]);
  });
});
