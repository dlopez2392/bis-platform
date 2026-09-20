import { describe, it, expect } from "vitest";
import {
  conciergeLockReason, shouldShowConciergeEmptyState, conciergeDestinationOptions,
  conciergeFormUnpublished, conciergeSnippetPublicId,
} from "./voice-settings";

/**
 * The pure decision behind the website-assistant toggle's disabled state —
 * extracted so it is testable without a DOM (this repo has no jsdom/.tsx
 * infra; see concierge-chat.tsx's own precedent for `pickTurnUpdate`).
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

describe("conciergeFormUnpublished — the ON+unpublished sentence", () => {
  it("is true when on and the stored destination is not among the published forms", () => {
    expect(conciergeFormUnpublished(true, "stored-id", [])).toBe(true);
    expect(
      conciergeFormUnpublished(true, "stored-id", [{ id: "other-id", name: "Other Form" }]),
    ).toBe(true);
  });

  // MUTATION: drop the `enabled &&` guard — this FAILS, because an account
  // that has never turned the assistant on (no destination chosen yet) would
  // get a "no longer published" sentence about a form it never pointed at.
  it("is false while off, even with a stored id that is not published", () => {
    expect(conciergeFormUnpublished(false, "stored-id", [])).toBe(false);
  });

  it("is false once the stored destination IS among the published forms", () => {
    expect(
      conciergeFormUnpublished(true, "stored-id", [{ id: "stored-id", name: "Contact us" }]),
    ).toBe(false);
  });

  it("is false with no stored destination at all", () => {
    expect(conciergeFormUnpublished(true, null, [])).toBe(false);
  });
});

describe("conciergeDestinationOptions — the Select never shows blank for a live destination", () => {
  it("is just the published forms when off, or when the stored id is one of them", () => {
    const published = [{ id: "f1", name: "Contact us" }];
    expect(conciergeDestinationOptions(false, "f1", published)).toBe(published);
    expect(conciergeDestinationOptions(true, "f1", published)).toBe(published);
  });

  // The stored id absent from `publishedForms`, with one other form present —
  // the exact scenario named in Task 6's review. MUTATION: return
  // `publishedForms` unchanged instead of appending the stored id — this
  // FAILS, and the Select's value would match no item, rendering blank for a
  // destination that is very much still live.
  it("names the stored form when it is on and no longer published, rather than dropping it", () => {
    const published = [{ id: "other-id", name: "Other Form" }];
    const options = conciergeDestinationOptions(true, "stored-id", published);
    expect(options).toContainEqual({ id: "other-id", name: "Other Form" });
    const stored = options.find((o) => o.id === "stored-id");
    expect(stored).toBeDefined();
    expect(stored!.name.trim().length).toBeGreaterThan(0);
  });

  it("adds nothing when off with no stored id yet", () => {
    const published = [{ id: "f1", name: "Contact us" }];
    expect(conciergeDestinationOptions(false, null, published)).toEqual(published);
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
