import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";
import { m } from "@/lib/messages";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { ReferralAskCard } from "./referral-ask-card";

/**
 * THE COUNTER MUST COUNT WHAT IS BILLED.
 *
 * `sendAutomationSms` appends the opt-out disclosure unconditionally
 * (send-sms.ts:82, `withOptOut(input.body, input.language)`) — a property of
 * the send path, not of any recipe's copy. A card that counts the composed
 * body alone reports a number no customer receives and no client is billed
 * for. The appointment-confirm card shipped that bug and it was caught in
 * review; this one is written the other way round from the start.
 */
const ROW: AutomationRow = {
  id: "au6", account_id: "a1", recipe_key: "referral_ask", enabled: true,
  body: "", config: { channel: "sms" }, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof ReferralAskCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ReferralAskCard, {
    automation: ROW, brandName: "Rio Roofing",
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

/** The text of the counter paragraph, by its own testid. */
function countText(html: string): string {
  const m = /data-testid="referral-ask-sms-count">([^<]*)</.exec(html);
  if (!m) throw new Error("the segment counter did not render");
  return m[1]!.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&#xB7;|&middot;/g, "·");
}

describe("the referral-ask card's segment counter", () => {
  it("MEASURED: counts the DISCLOSED text — 144 characters, not the 121 the composed body alone would show", () => {
    // The default body is 121 septets for this brand name; " Reply STOP to
    // opt out." is 23 more. Mutation: count the body without `withOptOut` →
    // this reds BY NAME.
    expect(countText(render())).toBe("144 characters · 1 message(s)");
  });

  it("MEASURED: a long company name puts the DISCLOSED text into a second segment the undisclosed one would hide", () => {
    // 140 septets composed, 163 disclosed: the undisclosed count says one
    // message and the client is billed for two. The copy's budget is a name
    // of 27 characters or fewer (messages.ts); this one is 30, so the second
    // segment here is REAL rather than a defect — and the counter is what
    // tells the agency before they turn it on. Mutation: count the body
    // without `withOptOut` → this reds on the MESSAGE COUNT, not merely on
    // the character count.
    expect(countText(render({ brandName: "Hernandez Brothers Sheet Metal" }))).toBe("163 characters · 2 message(s)");
  });

  it("does not double the disclosure when the operator's own message already says STOP", () => {
    // withOptOut is idempotent on a STOP instruction (hasOptOutInstruction,
    // opt-out.ts) and the counter inherits it, or the one operator who wrote the sentence themselves is
    // over-reported.
    const html = render({ automation: { ...ROW, body: "Know anyone else? Reply STOP to opt out." } });
    expect(countText(html)).toBe("40 characters · 1 message(s)");
  });

  it("carries NO LINK HINT — this recipe appends nothing, because it asks for a name", () => {
    // The no-show card's link line ("Added to the end: {link}", its own
    // `data-testid="no-show-link"`) has no counterpart here, and that absence
    // is this recipe's whole distinction from the review request.
    // NOT `not.toContain("http")`: shadcn's checkbox and select icons render
    // `xmlns="http://www.w3.org/2000/svg"`, so that assertion fails on a
    // CORRECT card — measured, not guessed. The two below are bound to the
    // thing claimed: no anchor anywhere in the card, and none of the
    // catalogue's link copy. Mutation: add a link hint line → reds.
    const html = render();
    expect(html).not.toContain("href=");
    expect(html).not.toContain("Added to the end");
    expect(html).toContain('data-testid="referral-ask-card"');
  });

  it("says out loud that the count includes the opt-out sentence, and only on the text channel", () => {
    // DESIGN REVIEW I3. The counter counts `withOptOut(previewBody)` — right,
    // because `sendAutomationSms` appends it unconditionally — but the 23
    // septets it counts appear NOWHERE on the page: the Textarea's
    // placeholder shows the undisclosed default. The operator read a number
    // 23 higher than any string on screen and nothing explained it.
    //
    // SMS-ONLY, and that is the reason it does not live on the message hint
    // beside it: the hint renders for both channels, and an emailed referral
    // ask has no opt-out sentence appended and no segment count at all, so
    // the same clause on the hint would be false half the time.
    // Mutation: delete the note → this reds; move it out of the
    // `channel === "sms"` branch → the email half reds.
    expect(render()).toContain(m["automations.optOutCounted"]);
    const email = render({ automation: { ...ROW, config: { channel: "email" } } });
    expect(email).not.toContain('data-testid="referral-ask-sms-count"');
    expect(email).not.toContain(m["automations.optOutCounted"]);
  });

  it("says why a text would be skipped when the company cannot text, and only for the text channel", () => {
    const blocked = render({ smsGate: { ok: false, reason: "a2p_not_approved" } });
    expect(blocked).toContain("Texting is off until this company");
    expect(render()).not.toContain("Texting is off until this company");
  });
});
