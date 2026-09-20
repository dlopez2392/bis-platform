import { describe, it, expect } from "vitest";
import { conciergeLockReason } from "./voice-settings";

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
