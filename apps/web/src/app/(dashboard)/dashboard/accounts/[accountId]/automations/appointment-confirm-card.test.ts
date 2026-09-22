import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { AppointmentConfirmCard } from "./appointment-confirm-card";

/**
 * THE COUNTER MUST COUNT WHAT IS BILLED.
 *
 * `sendAutomationSms` appends the opt-out disclosure unconditionally
 * (send-sms.ts:82, `withOptOut(input.body, input.language)`) — it is a
 * property of the send path, not of any recipe's copy. A card that counts the
 * composed body alone therefore reports a number no customer is ever sent and
 * no client is ever billed. For this recipe the lead is 137 septets plus the
 * brand name, so the disclosed text is 160 + len(brandName): there is NO
 * company name for which the undisclosed count is right, and the empty
 * closing line is the state every account starts in.
 *
 * The house shape is review-request-copy.test.ts's `MEASURED:` cases — assert
 * `chars` as well as `segments`, because `chars` reds even where the two
 * counts happen to land in the same segment.
 */
const ROW: AutomationRow = {
  id: "au5", account_id: "a1", recipe_key: "appointment_confirm", enabled: true,
  body: "", config: {}, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof AppointmentConfirmCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(AppointmentConfirmCard, {
    automation: ROW, brandName: "Rio Roofing", accountTimezone: "America/Chicago",
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

/** The text of the counter paragraph, by its own testid. */
function countText(html: string): string {
  const m = /data-testid="appointment-confirm-sms-count">([^<]*)</.exec(html);
  if (!m) throw new Error("the segment counter did not render");
  return m[1]!.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&#xB7;|&middot;/g, "·");
}

describe("the appointment-confirm card's segment counter", () => {
  it("MEASURED: counts the DISCLOSED text — 171 characters and TWO segments, not the 148 and one the composed body alone would show", () => {
    // The numbers: the composed lead is 148 septets; " Reply STOP to opt out."
    // is 23 more, which crosses GSM-7's 160-septet single-segment bound. An
    // operator who reads "1 message" here is billed for 2 on every booking.
    // Mutation: count `previewText` instead of the disclosed text → this reds
    // BY NAME on both numbers.
    expect(countText(render())).toBe("171 characters · 2 message(s)");
  });

  it("does not double the disclosure when the operator's own closing line already says STOP", () => {
    // withOptOut is idempotent on `\bstop\b` (opt-out.ts:63) and the counter
    // has to inherit that, or a card would over-report for the one operator
    // who wrote the sentence themselves. Mutation: append the disclosure
    // unconditionally instead of calling withOptOut → reds.
    const html = render({ automation: { ...ROW, body: "Reply STOP to opt out." } });
    expect(countText(html)).toBe("171 characters · 2 message(s)");
  });
});
