import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SmsPreview } from "./sms-preview";

/**
 * The one SMS preview box the Automations cards share (it was four
 * hand-copied `<Label>` + `<output>` pairs). What it must keep: the label
 * NAMES the preview (`for` = the output's `id`, which is what a screen reader
 * announces and what makes the `<output>` a named live region), the testid
 * the e2e specs address it by, and the text exactly as it will be sent.
 */
const html = renderToStaticMarkup(createElement(SmsPreview, {
  id: "demo-preview", label: "What the customer gets", testId: "demo-preview-box",
  text: "Hi, this is Rio Roofing. We got your message and will be in touch shortly.",
}));

describe("SmsPreview", () => {
  it("names the preview with its label: the label's `for` is the output's `id`", () => {
    // Mutation: drop `htmlFor` from the Label → reds BY NAME.
    expect(html).toMatch(/<label[^>]*for="demo-preview"[^>]*>What the customer gets<\/label>/);
    expect(html).toMatch(/<output id="demo-preview"/);
  });

  it("carries the caller's testid LAST on the output, where the card tests' regexes read the text from", () => {
    // instant-reply-card.test.ts reads `data-testid="…">([^<]*)</output>`, so
    // the testid is the output's last attribute. Mutation: drop `data-testid`
    // → reds BY NAME.
    expect(html).toContain('data-testid="demo-preview-box">Hi, this is Rio Roofing. We got your message and will be in touch shortly.</output>');
  });

  it("paints as a field in the control radius, spelled as the token", () => {
    // Mutation: `rounded-[8px]` back in → reds BY NAME.
    expect(html).toContain(
      'class="block rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--input-bg)] px-3 py-2 text-[13px]"',
    );
  });
});
