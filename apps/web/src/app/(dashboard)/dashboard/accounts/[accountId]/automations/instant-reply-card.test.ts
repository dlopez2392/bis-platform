import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";
import { m } from "@/lib/messages";

// Imported at module scope by the card; never called during a server render.
vi.mock("sonner", () => ({ toast: {} }));

import { InstantReplyCard } from "./instant-reply-card";

/**
 * THE PREVIEW IS THE TEXT THAT SENDS, AND THE COUNTER COUNTS THE PREVIEW.
 *
 * `sendAutomationSms` appends the opt-out disclosure unconditionally
 * (send-sms.ts:82), and the instant reply hands it the submission's own
 * locale (`language: input.locale`, lib/automations/instant-reply.ts:177-186),
 * so an English reply ends in `sms.optOut.en` and a Spanish one in
 * `sms.optOut.es`. This card has preview boxes, as the text-reminder and
 * confirmation cards do, so — like them — the box shows the DISCLOSED text and
 * each counter counts that same string (decision B, danlo, 2026-09-22).
 */
const ROW: AutomationRow = {
  id: "au3", account_id: "a1", recipe_key: "instant_reply", enabled: false,
  body: "", config: { bodyEs: "" }, created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

function render(over: Partial<Parameters<typeof InstantReplyCard>[0]> = {}): string {
  return renderToStaticMarkup(createElement(InstantReplyCard, {
    // No stored row → the card starts from the two defaults.
    automation: null, brandName: "Rio Roofing",
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] },
    saveAction: async () => ({ ok: true as const }),
    ...over,
  }));
}

const decode = (s: string) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&#xB7;|&middot;/g, "·");

function countText(html: string, lang: "en" | "es"): string {
  const found = new RegExp(`data-testid="instant-reply-count-${lang}">([^<]*)</p>`).exec(html);
  if (!found) throw new Error(`the ${lang} segment counter did not render`);
  return decode(found[1]!);
}

function previewText(html: string, lang: "en" | "es"): string {
  const found = new RegExp(`data-testid="instant-reply-preview-${lang}">([^<]*)</output>`).exec(html);
  if (!found) throw new Error(`the ${lang} preview did not render`);
  return decode(found[1]!);
}

describe("the instant-reply card's previews and counters", () => {
  it("MEASURED: each counter counts the DISCLOSED default — 139 and 135 characters, not 116 and 106", () => {
    // Measured with segmentsFor/withOptOut/defaultInstantReplyBody for "Rio
    // Roofing": English 116 septets composed, 139 disclosed (+23); Spanish
    // 106 composed, 135 disclosed (+29) — one segment each. Mutation: drop
    // `withOptOut` from the card's preview → this reds BY NAME.
    const html = render();
    expect(countText(html, "en")).toBe("139 characters · 1 message(s)");
    expect(countText(html, "es")).toBe("135 characters · 1 message(s)");
  });

  it("MEASURED: \"Valley Air Conditioning\" is ONE message in both languages, disclosed", () => {
    // The ledger's case: under the old Spanish default this name was 142
    // composed and 171 disclosed, TWO billed messages. With the shorter
    // default it is 118 → 147 in Spanish and 128 → 151 in English, one each.
    // Mutation: restore the old Spanish default → the Spanish half reds.
    const html = render({ brandName: "Valley Air Conditioning" });
    expect(countText(html, "es")).toBe("147 characters · 1 message(s)");
    expect(countText(html, "en")).toBe("151 characters · 1 message(s)");
  });

  it("MEASURED: a 39-character name shows ONE message undisclosed and bills TWO, in both languages", () => {
    // "Valley Air Conditioning and Heating LLC" (39): Spanish 134 septets
    // composed (one), 163 disclosed (two) — the Spanish default holds a name
    // of 36 characters or fewer; English 144 composed (one), 167 disclosed
    // (two) — the English holds 32. Mutation: drop `withOptOut` → this reds
    // on the MESSAGE COUNT, not merely on the character count.
    const html = render({ brandName: "Valley Air Conditioning and Heating LLC" });
    expect(countText(html, "es")).toBe("163 characters · 2 message(s)");
    expect(countText(html, "en")).toBe("167 characters · 2 message(s)");
  });

  it("the Spanish preview ends in the SPANISH disclosure, the English one in the English", () => {
    // The send passes `language: input.locale`, so a Spanish reply never ends
    // in "Reply STOP to opt out." Mutation: `withOptOut(bodyEs.trim(), "en")`
    // → this reds.
    const html = render();
    expect(previewText(html, "es").endsWith(` ${m["sms.optOut.es"]}`)).toBe(true);
    expect(previewText(html, "es")).not.toContain(m["sms.optOut.en"]);
    expect(previewText(html, "en").endsWith(` ${m["sms.optOut.en"]}`)).toBe(true);
    expect(previewText(html, "en")).toBe(
      "Hi, this is Rio Roofing. We got your message and will be in touch shortly. Reply here if you'd like to add anything. Reply STOP to opt out.",
    );
  });

  it("an EMPTY stored text previews as empty — the send skips it, so the disclosure alone must not appear", () => {
    // instant-reply.ts:119-120: a blank body for the lead's locale is
    // `skipped` ("empty … body"), never sent — there is no default at send
    // time. `withOptOut("")` is " Reply STOP to opt out.", a text nobody
    // would receive, so the card guards the empty case rather than preview
    // it. The counter counts the same empty string (segmentsFor("") →
    // 0 characters, 1 segment — segments.ts's own floor, unchanged here).
    // Mutation: drop the empty guard → the preview shows the bare
    // disclosure and this reds.
    const html = render({ automation: { ...ROW, body: "   ", config: { bodyEs: "" } } });
    expect(previewText(html, "en")).toBe("");
    expect(previewText(html, "es")).toBe("");
    expect(countText(html, "en")).toBe("0 characters · 1 message(s)");
  });

  it("carries no separate opt-out note — the sentence is visible in the preview itself", () => {
    // Unlike the review, nudge and referral cards, whose message box shows
    // the undisclosed default, this card's preview SHOWS the disclosure.
    expect(render()).not.toContain(m["automations.optOutCounted"]);
  });
});
