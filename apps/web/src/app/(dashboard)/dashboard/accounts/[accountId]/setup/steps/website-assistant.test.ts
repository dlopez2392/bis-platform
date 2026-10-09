import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupStepView } from "@/lib/setup/setup-view";
import type { StepDetailProps } from "./step-shared";
import { renderedText } from "@/lib/rendered-text";
import { WebsiteAssistantStep } from "./website-assistant";
import { VoiceProfileStep } from "./voice-profile";
import { m } from "@/lib/messages";

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
    profileReadFailed: false,
    publishedFormCount: 0,
    conciergeSiteConversation: false,
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

  it("(b) ON with a public id, one published form, no site conversation yet — rows 1-3 done, row 4 'not seen yet', the embed attribute carries the public id", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x", greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", languages: "en" },
      publishedFormCount: 1,
      conciergeSiteConversation: false,
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

  it("(c) ON, a real site conversation exists — row 4 reads done", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x", greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", languages: "en" },
      publishedFormCount: 1,
      conciergeSiteConversation: true,
    });
    const text = renderedText(html);

    expect(html).toMatch(/data-row="4" data-row-state="done"/);
    expect(text).toContain("A visitor has opened it from your site");
  });

  it("(d) the conversations read failed — row 4 renders unknown, never 'not seen'", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x", greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", languages: "en" },
      publishedFormCount: 1,
      conciergeSiteConversation: "unknown",
    });
    const text = renderedText(html);

    expect(html).toMatch(/data-row="4" data-row-state="unknown"/);
    expect(text).not.toContain("Not seen on your site yet");
  });

  // Fix-round review, IMPORTANT 3: row 2's own unknown branch had no pinning
  // test — collapsing it to `publishedFormCount > 0 ? "done" : "open"` left
  // the suite green while a failed forms read rendered "To do" under a rail
  // that says "Couldn't check". The mirror of case (d), for row 2.
  it("(e) the forms read failed — row 2 renders unknown, never the not-done word", () => {
    const html = render({ publishedFormCount: "unknown" });
    // MUTATION: collapse row 2's condition to `publishedFormCount > 0 ?
    // "done" : "open"` — this FAILS, reading "open" here instead.
    expect(html).toMatch(/data-row="2" data-row-state="unknown"/);
    // Scoped to row 2 alone — rows 1/3/4 are legitimately "To do" in this
    // OFF fixture, so the negative assertion has to isolate row 2's own
    // status chip rather than the whole page's text.
    const row2 = /<div data-row="2"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? "";
    expect(renderedText(row2)).toContain("Couldn't check");
    expect(renderedText(row2)).not.toContain("To do");
  });

  it("a failed voice_profile read marks row 1 unknown, never 'not done'", () => {
    const html = render({ views: views({ done: false, unknown: true }) });
    expect(html).toMatch(/data-row="1" data-row-state="unknown"/);
  });

  // Review round, Important 1: on a CRM-only plan `deriveSetupStatus` drops
  // `voice_profile` entirely, so `views` carries no entry for it at all —
  // `views.find(v => v.key === "voice_profile")` is `undefined`. Row 1 has
  // to ask `isVoiceProfileDone` directly off `conciergeProfile` (the same
  // `voice_profiles` row, widened to carry facts/greetings/languages) in
  // that shape, and read `unknown` off `profileReadFailed` instead of a
  // views entry that doesn't exist.
  function crmOnlyViews(): SetupStepView[] {
    const of = (key: SetupStepView["key"], over: Partial<SetupStepView> = {}): SetupStepView => ({
      key, done: false, skipped: false, unknown: false, ...over,
    });
    return [
      of("account", { done: true }), of("branding"), of("hours"),
      of("website_assistant"), of("email"),
    ];
  }

  describe("CRM-only plan — no voice_profile view at all", () => {
    // MUTATION: drop the `voiceProfileView ? ... : isVoiceProfileDone(...)`
    // fallback and read `voiceProfileView?.done === true` alone — this
    // FAILS, because `voiceProfileView` is `undefined` on this plan shape
    // and the mutant reads row 1 as permanently "To do" even though the
    // profile below genuinely has both a greeting and facts.
    it("row 1 reads DONE when the profile (read off conciergeProfile, not a views entry) has both a greeting and facts", () => {
      const html = render({
        views: crmOnlyViews(),
        conciergeProfile: {
          concierge_enabled: false, concierge_form_id: null, public_id: null,
          greeting_en: "Thanks for calling!", greeting_es: "", facts: "We fix things.", languages: "en",
        },
        profileReadFailed: false,
      });
      expect(html).toMatch(/data-row="1" data-row-state="done"/);
    });

    it("row 1 reads OPEN (not unknown) when the profile genuinely has no facts yet — a real, unconfigured state, not a read failure", () => {
      const html = render({
        views: crmOnlyViews(),
        conciergeProfile: {
          concierge_enabled: false, concierge_form_id: null, public_id: null,
          greeting_en: "", greeting_es: "", facts: "", languages: "en",
        },
        profileReadFailed: false,
      });
      expect(html).toMatch(/data-row="1" data-row-state="open"/);
    });

    it("row 1 reads OPEN when there is no voice_profiles row at all (conciergeProfile null, read did not fail)", () => {
      const html = render({
        views: crmOnlyViews(), conciergeProfile: null, profileReadFailed: false,
      });
      expect(html).toMatch(/data-row="1" data-row-state="open"/);
    });

    // MUTATION: drop the `voiceProfileView ? ... : profileReadFailed`
    // fallback and read `voiceProfileView?.unknown === true` alone — this
    // FAILS, always reading `false` (since `voiceProfileView` is
    // `undefined`), so a failed read on a CRM-only account would render
    // row 1 "To do" instead of "Couldn't check".
    it("row 1 reads UNKNOWN, never 'To do', when the profile read itself failed", () => {
      const html = render({
        views: crmOnlyViews(), conciergeProfile: null, profileReadFailed: true,
      });
      expect(html).toMatch(/data-row="1" data-row-state="unknown"/);
    });
  });

  // Fix-round review, MINOR 7: the embed card is nested INSIDE this pane's
  // own card (--surface-1), so it must paint from the ladder's next step.
  it("the nested embed card paints from --surface-2, not --surface-1 on --surface-1", () => {
    const html = render({
      views: views({ done: true }),
      conciergeProfile: { concierge_enabled: true, concierge_form_id: "form_1", public_id: "pub_x", greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", languages: "en" },
      publishedFormCount: 1,
      conciergeSiteConversation: false,
    });
    // MUTATION: force `surface="1"` (or drop the prop) at the call site —
    // this FAILS, since the class would then be absent.
    expect(html).toMatch(/class="[^"]*bg-\[var\(--surface-2\)\][^"]*"/);
  });
});

/**
 * Review of D-108: a bilingual profile with the English greeting written and
 * the Spanish one blank read "Write the greeting and facts: To do", pointing
 * the operator at a greeting they had already written. The row now says the
 * Spanish greeting is what is missing; nothing else changes the row's title.
 */
describe("WebsiteAssistantStep row 1 — names the Spanish greeting when that is the only gap", () => {
  const BILINGUAL = {
    concierge_enabled: false, concierge_form_id: null, public_id: null,
    greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", languages: "both" as const,
  };

  it("shows the Spanish-greeting sentence on row 1 when only greeting_es is blank", () => {
    const text = renderedText(render({ views: views({ done: false }), conciergeProfile: BILINGUAL }));
    expect(text).toContain(m["setup.profile.spanishGreetingMissing"]);
  });

  it("shows no such sentence when the gap is the facts, or nothing is missing", () => {
    const factsGap = renderedText(render({
      views: views({ done: false }),
      conciergeProfile: { ...BILINGUAL, greeting_es: "¡Hola!", facts: "" },
    }));
    expect(factsGap).not.toContain(m["setup.profile.spanishGreetingMissing"]);
    const ready = renderedText(render({
      views: views({ done: true }),
      conciergeProfile: { ...BILINGUAL, greeting_es: "¡Hola!" },
    }));
    expect(ready).not.toContain(m["setup.profile.spanishGreetingMissing"]);
  });
});

describe("VoiceProfileStep — names the Spanish greeting when that is the only gap", () => {
  it("shows the Spanish-greeting sentence for a bilingual profile missing only greeting_es", () => {
    const html = renderToStaticMarkup(createElement(VoiceProfileStep, baseProps({
      step: { key: "voice_profile", done: false, skipped: false, unknown: false },
      href: `${BASE}/voice?from=setup`,
      conciergeProfile: {
        concierge_enabled: false, concierge_form_id: null, public_id: null,
        greeting_en: "Hi!", greeting_es: "", facts: "We fix things.", languages: "both",
      },
    })));
    expect(renderedText(html)).toContain(m["setup.profile.spanishGreetingMissing"]);
  });

  it("shows nothing extra for an English-only profile", () => {
    const html = renderToStaticMarkup(createElement(VoiceProfileStep, baseProps({
      step: { key: "voice_profile", done: false, skipped: false, unknown: false },
      href: `${BASE}/voice?from=setup`,
      conciergeProfile: {
        concierge_enabled: false, concierge_form_id: null, public_id: null,
        greeting_en: "Hi!", greeting_es: "", facts: "", languages: "en",
      },
    })));
    expect(renderedText(html)).not.toContain(m["setup.profile.spanishGreetingMissing"]);
  });
});
