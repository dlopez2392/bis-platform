import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";

vi.mock("sonner", () => ({ toast: {} }));

import { SmsReminderCard } from "./sms-reminder-card";

/**
 * The same counter defect the confirmation card had, in the card that shipped
 * first: `sendAutomationSms` appends the opt-out disclosure unconditionally
 * (send-sms.ts, `withOptOut`), so a count of the composed body alone is 23
 * septets short of what is billed. This card was saved only by its DEFAULT
 * closing line landing 15 septets inside GSM-7's 160 bound — a real operator
 * body pushes the disclosed text over while the composed body stays under,
 * and the card then says "1 message" for a text that costs two.
 *
 * The two cards sit side by side and render ONE preview component
 * (components/sms-preview.tsx) so they cannot show the same idea two ways;
 * both count and render the DISCLOSED string.
 */
const ROW: AutomationRow = {
  id: "au3", account_id: "a1", recipe_key: "sms_reminder", enabled: true,
  body: "", config: {}, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(body: string): string {
  return renderToStaticMarkup(createElement(SmsReminderCard, {
    automation: { ...ROW, body }, brandName: "Rio Roofing", accountTimezone: "America/Chicago",
    smsGate: { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    saveAction: async () => ({ ok: true as const }),
  }));
}

function countText(html: string): string {
  const m = /data-testid="sms-reminder-count">([^<]*)</.exec(html);
  if (!m) throw new Error("the segment counter did not render");
  return m[1]!.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
}

describe("the text-reminder card's segment counter", () => {
  it("MEASURED: counts the DISCLOSED default — 145 characters, not the 122 the composed body alone would show", () => {
    // Both land in ONE segment, which is exactly why `chars` is asserted and
    // not just `segments`: this is the case the old counter got wrong without
    // anyone being able to see it. Mutation: count the composed body → reds
    // BY NAME (122 vs 145).
    expect(countText(render(""))).toBe("145 characters · 1 message(s)");
  });

  it("MEASURED: an operator's own 76-character closing line is TWO segments once disclosed, where the composed body alone reads as one", () => {
    // 150 septets composed (one segment) → 173 disclosed (two). The straddle
    // is the whole defect: the operator approves "1 message(s)" and the
    // client is billed for two on every appointment. Mutation: count the
    // composed body → this reds BY NAME on both numbers.
    const body = "Please text us back if you need to move it, or if we should watch for a dog.";
    expect(body).toHaveLength(76);
    expect(countText(render(body))).toBe("173 characters · 2 message(s)");
  });
});
