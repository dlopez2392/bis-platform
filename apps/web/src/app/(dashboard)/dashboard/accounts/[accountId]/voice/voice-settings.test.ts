import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceProfileRow } from "@bis/db";
import {
  conciergeLockReason, shouldShowConciergeEmptyState, conciergeDestinationOptions,
  conciergeFormUnpublished, conciergeSnippetPublicId, conciergeToggleLocked, ConciergeCard,
} from "./voice-settings";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

/**
 * The pure decision behind the website-assistant toggle's disabled state —
 * extracted so it is testable without a DOM. This repo DOES have a render
 * harness for `.tsx` — `renderToStaticMarkup` + `createElement`, the same
 * shape `calls-table.test.ts` uses on a client component — but these
 * decisions are still pulled out into pure functions because a unit test
 * over a boolean is simpler to write and to read than one over rendered
 * markup; see the card-level describe block near the bottom of this file
 * for the render proof that binds them to the actual JSX.
 *
 * Three locked states, each real production states per the brief:
 *   - no `voice_profiles` row at all (an account that has never saved voice
 *     settings has none — voice-settings.tsx's own DEFAULT_PROFILE comment)
 *   - a blank greeting (`greeting_en`'s DB default is `''`)
 *   - no published form to send leads to
 */
describe("conciergeLockReason", () => {
  const readyProfile = { greeting_en: "Hi, thanks for calling.", greeting_es: "", languages: "en" as const };

  it("locks on a missing profile row before checking anything else", () => {
    expect(conciergeLockReason(null, 3)).toBe("no_profile");
  });

  it("locks on a blank English greeting", () => {
    // MUTATION: check only `!profile.greeting_en` without `.trim()` — this
    // still FAILS for a whitespace-only greeting, which is exactly the case
    // an operator who pressed space and walked away leaves behind.
    expect(conciergeLockReason({ ...readyProfile, greeting_en: "   " }, 3)).toBe("blank_greeting");
  });

  it("does not require a Spanish greeting for an English-only line", () => {
    expect(conciergeLockReason({ ...readyProfile, languages: "en" }, 3)).toBeNull();
  });

  it("locks a bilingual line on a blank Spanish greeting even though English is filled", () => {
    // MUTATION: drop this branch entirely (only ever check greeting_en) —
    // this FAILS, because a bilingual line with no Spanish greeting would
    // open a chat that goes silent for half its callers.
    expect(conciergeLockReason({ ...readyProfile, languages: "both", greeting_es: "" }, 3)).toBe("blank_greeting");
  });

  it("a Spanish-only line locks on its OWN greeting being blank, not the unused English one", () => {
    expect(
      conciergeLockReason({ greeting_en: "", greeting_es: "Hola, gracias por llamar.", languages: "es" }, 3),
    ).toBe("blank_greeting");
  });

  it("locks on no published form once the profile is ready", () => {
    expect(conciergeLockReason(readyProfile, 0)).toBe("no_published_form");
  });

  it("is unlocked once a profile, a real greeting and a published form all exist", () => {
    expect(conciergeLockReason(readyProfile, 1)).toBeNull();
  });
});

/**
 * The review's Important 2 (Task 6 Step 4's "ON state" clause, added to the
 * plan after the first draft shipped): `conciergeLockReason` alone decided
 * whether the card's empty state replaced its whole body, with no regard for
 * `enabled`. An assistant switched ON whose destination form is later
 * unpublished still reads `no_published_form` from the pure function above —
 * correctly, that function knows nothing about `enabled` — but rendering the
 * empty state for THAT case hides the toggle entirely: an ON assistant with
 * no way to turn it off, under copy that says it is off. These three
 * functions are what the component's render actually branches on now.
 */
describe("shouldShowConciergeEmptyState — the empty state is an OFF-state only", () => {
  it("shows the empty state when off with nothing published", () => {
    expect(shouldShowConciergeEmptyState(false, "no_published_form")).toBe(true);
  });

  // MUTATION: drop the `!enabled &&` guard, deciding from lockReason alone —
  // this FAILS: an ON assistant whose form was unpublished out from under it
  // would vanish behind the empty state, with no toggle left to turn it off.
  it("never shows the empty state while the assistant is ON, even with nothing published", () => {
    expect(shouldShowConciergeEmptyState(true, "no_published_form")).toBe(false);
  });

  it("does not show it for any other lock reason", () => {
    expect(shouldShowConciergeEmptyState(false, "no_profile")).toBe(false);
    expect(shouldShowConciergeEmptyState(false, null)).toBe(false);
  });
});

/**
 * Fix round 2, IMPORTANT B: both helpers below used to take `enabled` and
 * gate on it. The bug that closes: `disableConcierge` clears neither
 * `concierge_enabled` nor `concierge_form_id`'s effect on the Select, so an
 * OFF assistant with a stale unpublished id still SHOWING in the trigger
 * read `conciergeFormUnpublished` as false (the old `enabled &&` guard) and
 * got no `unpublishedFormOption` entry either (the old `!enabled ||` early
 * return) — a blank trigger, no lock reason, and one click away from
 * `enableAction` going live on a form the operator was never shown. Both
 * helpers now take the id the Select is actually SHOWING (`selectedFormId`
 * in the component, equal to the stored id while ON, editable while OFF) and
 * answer identically regardless of the toggle's own state — there is no
 * `enabled` branch left to guard, because the blank-Select symptom lived on
 * BOTH faces, not just the ON one.
 */
describe("conciergeFormUnpublished — the shown destination's own state, in both faces", () => {
  it("is true when the shown id is not among the published forms", () => {
    expect(conciergeFormUnpublished("stored-id", [])).toBe(true);
    expect(
      conciergeFormUnpublished("stored-id", [{ id: "other-id", name: "Other Form" }]),
    ).toBe(true);
  });

  it("is false once the shown id IS among the published forms", () => {
    expect(
      conciergeFormUnpublished("stored-id", [{ id: "stored-id", name: "Contact us" }]),
    ).toBe(false);
  });

  it("is false with no shown id at all", () => {
    expect(conciergeFormUnpublished("", [])).toBe(false);
  });

  // The OFF face, named explicitly: nothing here reads differently than the
  // base case above, which is the whole point — the old code answered
  // `false` here regardless of the id, because `enabled` was false. MUTATION:
  // reinstate an `enabled`-shaped early return (hardcode it false, since the
  // parameter is gone) — this FAILS.
  it("is true while OFF too, whenever the shown id is not among the published forms", () => {
    expect(
      conciergeFormUnpublished("stored-id", [{ id: "other-id", name: "Other Form" }]),
    ).toBe(true);
  });
});

describe("conciergeDestinationOptions — the Select never shows blank for a shown destination", () => {
  it("is just the published forms when the shown id is empty, or already among them", () => {
    const published = [{ id: "f1", name: "Contact us" }];
    expect(conciergeDestinationOptions("", published)).toBe(published);
    expect(conciergeDestinationOptions("f1", published)).toBe(published);
  });

  // The shown id absent from `publishedForms`, with one other form present —
  // the exact scenario named in Task 6's review. MUTATION: return
  // `publishedForms` unchanged instead of appending the shown id — this
  // FAILS, and the Select's value would match no item, rendering blank for a
  // destination that is very much still live.
  it("names the shown form when it is not among the published forms, rather than dropping it", () => {
    const published = [{ id: "other-id", name: "Other Form" }];
    const options = conciergeDestinationOptions("stored-id", published);
    expect(options).toContainEqual({ id: "other-id", name: "Other Form" });
    const stored = options.find((o) => o.id === "stored-id");
    expect(stored).toBeDefined();
    expect(stored!.name.trim().length).toBeGreaterThan(0);
  });

  it("adds nothing when the shown id is empty", () => {
    const published = [{ id: "f1", name: "Contact us" }];
    expect(conciergeDestinationOptions("", published)).toEqual(published);
  });

  // The OFF face, named explicitly — same reasoning as the sibling test
  // above: this is not a new code path, it is proof the old `enabled ||`
  // guard is gone. MUTATION: reinstate it (hardcode `enabled` false) — this
  // FAILS, because the Select would go back to dropping the id and rendering
  // blank while the assistant is off.
  it("names the shown form while OFF too — the axis is the id the Select renders, not whether the assistant is on", () => {
    const published = [{ id: "other-id", name: "Other Form" }];
    const options = conciergeDestinationOptions("stored-id", published);
    expect(options.find((o) => o.id === "stored-id")).toBeDefined();
  });
});

/**
 * The toggle's own disabled state, extracted (optional per the brief, taken
 * here) so the new lock — an OFF assistant may not go live on an unpublished
 * shown destination — is unit-testable like its siblings, rather than only
 * provable by rendering the checkbox's `disabled` attribute.
 */
describe("conciergeToggleLocked — the toggle's own disabled state", () => {
  it("is never locked while ON, however the shown form fares", () => {
    expect(conciergeToggleLocked(true, null, "f1", true)).toBe(false);
    expect(conciergeToggleLocked(true, null, "f1", false)).toBe(false);
  });

  it("locks while off on every pre-existing lock reason", () => {
    expect(conciergeToggleLocked(false, "no_profile", "", false)).toBe(true);
    expect(conciergeToggleLocked(false, "blank_greeting", "", false)).toBe(true);
    expect(conciergeToggleLocked(false, null, "", false)).toBe(true);
  });

  // The new lock (fix round 2): a real profile, a real greeting, a form
  // chosen — every pre-existing gate open — but that chosen destination is
  // no longer published. MUTATION: drop `|| formUnpublished` from the
  // expression — this FAILS.
  it("locks while off when the shown destination is unpublished, even with everything else ready", () => {
    expect(conciergeToggleLocked(false, null, "f1", true)).toBe(true);
  });

  it("is unlocked while off once everything is ready", () => {
    expect(conciergeToggleLocked(false, null, "f1", false)).toBe(false);
  });
});

describe("conciergeSnippetPublicId — what the pasteable snippet renders from", () => {
  it("prefers the server-confirmed id once the assistant reads as ON", () => {
    expect(conciergeSnippetPublicId(true, "real-id", null)).toBe("real-id");
    // Even over a stale optimistic id left from an earlier click.
    expect(conciergeSnippetPublicId(true, "real-id", "stale-id")).toBe("real-id");
  });

  // MUTATION: drop the optimistic fallback (`optimisticPublicId` unused) —
  // this FAILS. Right after a successful enable, `revalidatePath`'s refresh
  // has not landed yet, so `enabled`/`profile.public_id` are still the STALE
  // pre-click values; without the fallback the snippet would not appear
  // until that refresh completes, discarding the id the action just handed
  // back for nothing.
  it("falls back to the id the enable action just returned, before the refresh lands", () => {
    expect(conciergeSnippetPublicId(false, null, "just-minted")).toBe("just-minted");
  });

  it("shows nothing when neither exists", () => {
    expect(conciergeSnippetPublicId(false, null, null)).toBeNull();
  });
});

/**
 * MINOR B (fix round 2): the round-1 report claimed "no render harness for
 * .tsx" — wrong (doc correction 3). `renderToStaticMarkup` + `createElement`
 * is the harness `calls-table.test.ts` already uses on a client component;
 * these three tests bind the helper functions above to the actual JSX that
 * calls them, which no test in this file did before now — round 1's defect
 * lived in a JSX ternary, and pointing it back at `lockReason` alone left
 * every helper test above green.
 *
 * `enableAction`/`disableAction` are async stubs. A `renderToStaticMarkup`
 * pass never fires an event handler, so asserting they are never called is
 * mostly documentation of that fact rather than a check that can fail — the
 * real proof is the markup itself.
 */
describe("ConciergeCard — the render proof", () => {
  const BASE_PROFILE: VoiceProfileRow = {
    id: "vp1", account_id: "a1", persona_name: "Sofía",
    greeting_en: "Hi, thanks for calling.", greeting_es: "", facts: "", services: "",
    languages: "en", booking_enabled: true, after_hours: "hours_then_message",
    enabled: true, textback_enabled: false, textback_body: "",
    public_id: null, concierge_enabled: false, concierge_form_id: null,
  };

  function renderCard(opts: {
    enabled: boolean;
    storedFormId: string | null;
    publishedForms: { id: string; name: string }[];
  }) {
    const profile: VoiceProfileRow = {
      ...BASE_PROFILE, concierge_enabled: opts.enabled, concierge_form_id: opts.storedFormId,
    };
    const enableAction = vi.fn(async () => ({ ok: true as const, publicId: "pub_x" }));
    const disableAction = vi.fn(async () => ({ ok: true as const }));
    const html = renderToStaticMarkup(
      createElement(ConciergeCard, {
        accountId: "a1", profile, publishedForms: opts.publishedForms,
        origin: "https://app.example.com", enableAction, disableAction,
      }),
    );
    expect(enableAction).not.toHaveBeenCalled();
    expect(disableAction).not.toHaveBeenCalled();
    return html;
  }

  // Radix does not render `SelectItem`s outside an open Select, and
  // `SelectValue` renders empty in static markup — so this asserts the
  // checkbox's own attributes and the sentences beside it, never option text.
  // Two lookaheads rather than one literal string, `calls-table.test.ts`'s
  // own precedent: Radix's checkbox emits `id`, `data-state` and `disabled`
  // in a fixed but unrelated order, and the disabled lookahead is anchored on
  // a LEADING SPACE so it cannot match inside the neighbouring
  // `data-disabled=""` attribute, which is present whenever `disabled` is.
  const CHECKED_CHECKBOX =
    /<button\b(?=[^>]*\bid="concierge_enabled")(?=[^>]*\bdata-state="checked")[^>]*>/;
  const DISABLED_CHECKBOX =
    /<button\b(?=[^>]*\bid="concierge_enabled")(?=[^>]* disabled="")[^>]*>/;

  it("ON with nothing published: the toggle renders enabled and checked (it is the off switch), the ON sentence shows, and the empty state never replaces it", () => {
    const html = renderCard({ enabled: true, storedFormId: "A", publishedForms: [] });
    const text = renderedText(html);
    expect(html).toMatch(CHECKED_CHECKBOX);
    expect(html).not.toMatch(DISABLED_CHECKBOX);
    expect(text).toContain(m["voice.assistant.formUnpublished"]);
    expect(text).not.toContain(m["voice.assistant.noFormTitle"]);
  });

  it("OFF with the stored destination unpublished: the toggle locks, and the OFF sentence names the reason", () => {
    const html = renderCard({
      enabled: false, storedFormId: "A", publishedForms: [{ id: "B", name: "Contact us" }],
    });
    const text = renderedText(html);
    expect(html).toMatch(DISABLED_CHECKBOX);
    expect(text).toContain(m["voice.assistant.formUnpublishedOff"]);
    expect(text).not.toContain(m["voice.assistant.noFormTitle"]);
  });

  it("OFF with the stored destination published: no lock, no sentence", () => {
    const html = renderCard({
      enabled: false, storedFormId: "A",
      publishedForms: [{ id: "A", name: "Contact us" }, { id: "B", name: "Other" }],
    });
    const text = renderedText(html);
    expect(html).not.toMatch(DISABLED_CHECKBOX);
    expect(text).not.toContain(m["voice.assistant.formUnpublishedOff"]);
    expect(text).not.toContain(m["voice.assistant.formUnpublished"]);
  });
});
