import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupStepView } from "@/lib/setup/setup-view";
import type { StepDetailProps } from "./step-shared";
import { renderedText } from "@/lib/rendered-text";
import { WebsiteAssistantStep } from "./website-assistant";

// `EmbedSnippet` uses `useState` and a click handler but no router hook, so —
// unlike calls-table.test.ts's `next/navigation` mock — nothing here needs
// stubbing for a plain `renderToStaticMarkup` pass.

const BASE = "/dashboard/accounts/acct1";

function views(voiceProfile: Partial<SetupStepView> = {}): SetupStepView[] {
  const of = (key: SetupStepView["key"], over: Partial<SetupStepView> = {}): SetupStepView => ({
    key, done: false, skipped: false, unknown: false, ...over,
  });
  return [
    of("account", { done: true }), of("branding"), of("hours"),
    of("voice_profile", voiceProfile),
    of("website_assistant"), of("number"), of("email"), of("forwarding"),
    of("test_call"), of("go_live"),
  ];
}

const noop = async () => ({ ok: true as const });

function baseProps(overrides: Partial<StepDetailProps> = {}): StepDetailProps {
  return {
    step: { key: "website_assistant", done: false, skipped: false, unknown: false },
    kind: "open",
    base: BASE,
    href: null,
    assignedNumber: null,
    movableNumbers: [],
    hasVoiceProfile: false,
    tickAction: noop as unknown as StepDetailProps["tickAction"],
    goLiveAction: noop as unknown as StepDetailProps["goLiveAction"],
    moveNumberAction: noop as unknown as StepDetailProps["moveNumberAction"],
    enableTestCallsAction: noop as unknown as StepDetailProps["enableTestCallsAction"],
    prereqsMet: false,
    blockedReason: null,
    accountName: null,
    renameAction: noop as unknown as StepDetailProps["renameAction"],
    views: views(),
    conciergeProfile: null,
    publishedFormCount: 0,
    conciergeSiteConversations: 0,
    origin: "https://app.example.com",
    ...overrides,
  };
}

function render(overrides: Partial<StepDetailProps> = {}): string {
  return renderToStaticMarkup(createElement(WebsiteAssistantStep, baseProps(overrides)));
}

describe("WebsiteAssistantStep", () => {
  it("(a) OFF, no published forms — all four rows render not-done, row 4 shows the OFF sentence and no embed attribute", () => {
    const html = render();
    const text = renderedText(html);

    expect(text).toContain("Write the greeting and facts");
    expect(text).toContain("Publish a form for its leads");
    expect(text).toContain("Turn it on and pick the form");
    expect(text).toContain("Paste the code into the website");

    // Rows 2, 3, 4 not done.
    expect(html).toMatch(/data-row="2" data-row-state="open"/);
    expect(html).toMatch(/data-row="3" data-row-state="open"/);
    expect(html).toMatch(/data-row="4" data-row-state="open"/);

    expect(text).toContain("The line to paste appears here once it is on.");
    expect(html).not.toContain("data-concierge=");
  });

  it("(b) ON with a public id, one published form, zero site conversations — rows 1-3 done, row 4 'not seen yet', the embed attribute carries the public id", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x" },
      publishedFormCount: 1,
      conciergeSiteConversations: 0,
    });
    const text = renderedText(html);

    expect(html).toMatch(/data-row="1" data-row-state="done"/);
    expect(html).toMatch(/data-row="2" data-row-state="done"/);
    expect(html).toMatch(/data-row="3" data-row-state="done"/);
    expect(html).toMatch(/data-row="4" data-row-state="open"/);
    expect(text).toContain("Not seen on your site yet");
    // The snippet is rendered as literal script-tag TEXT inside a <pre><code>
    // (EmbedSnippet's own shape), so React escapes its quotes to `&quot;` —
    // `renderedText` decodes exactly that entity, same trap its own doc
    // comment warns about for apostrophes.
    expect(text).toContain('data-concierge="pub_x"');
  });

  it("(c) ON, real site conversations — row 4 reads done", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x" },
      publishedFormCount: 1,
      conciergeSiteConversations: 2,
    });
    const text = renderedText(html);

    expect(html).toMatch(/data-row="4" data-row-state="done"/);
    expect(text).toContain("A visitor has opened it from your site");
  });

  it("(d) the conversations read failed — row 4 renders unknown, never 'not seen'", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x" },
      publishedFormCount: 1,
      conciergeSiteConversations: "unknown",
    });
    const text = renderedText(html);

    expect(html).toMatch(/data-row="4" data-row-state="unknown"/);
    expect(text).not.toContain("Not seen on your site yet");
  });

  it("a failed voice_profile read marks row 1 unknown, never 'not done'", () => {
    const html = render({ views: views({ done: false, unknown: true }) });
    expect(html).toMatch(/data-row="1" data-row-state="unknown"/);
  });

  // MUTATION: swap row 4's condition to `conciergeSiteConversations >= 0` —
  // this FAILS test (b): 0 satisfies `>= 0`, so row 4 would read "done" with
  // zero real visitors, and the assertion above (row 4 stays "open") breaks.
  it("row 4 does not read done on a count of exactly zero", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x" },
      conciergeSiteConversations: 0,
    });
    expect(html).toMatch(/data-row="4" data-row-state="open"/);
  });
});
