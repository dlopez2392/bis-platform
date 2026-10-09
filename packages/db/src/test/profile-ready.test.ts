import { describe, it, expect } from "vitest";
import { assistantProfileGap, isAssistantProfileReady } from "../profile-ready";

/**
 * D-108: the ONE question three places used to answer three ways — Setup's
 * "write the greeting and facts" row (`isVoiceProfileDone`), the Voice page's
 * website-assistant toggle (`conciergeLockReason`) and the server write
 * (`enableConcierge`). The rule: every greeting the profile's language
 * setting will actually show (English for `en`, Spanish for `es`, both for
 * `both`) plus the facts the assistant answers from.
 */
describe("assistantProfileGap / isAssistantProfileReady", () => {
  const ready = {
    greeting_en: "Thanks for calling.", greeting_es: "Gracias por llamar.",
    facts: "Open weekdays 8 to 5.", languages: "both" as const,
  };

  it("is ready when every greeting the language needs and the facts are written", () => {
    expect(assistantProfileGap(ready)).toBeNull();
    expect(isAssistantProfileReady(ready)).toBe(true);
  });

  it("a Spanish-only profile needs no English greeting (D-051)", () => {
    const es = { ...ready, languages: "es" as const, greeting_en: "" };
    expect(assistantProfileGap(es)).toBeNull();
    expect(isAssistantProfileReady(es)).toBe(true);
  });

  it("a Spanish-only profile still needs its own Spanish greeting", () => {
    expect(assistantProfileGap({ ...ready, languages: "es", greeting_es: "  " })).toBe("greeting");
  });

  it("an English-only profile needs no Spanish greeting", () => {
    expect(assistantProfileGap({ ...ready, languages: "en", greeting_es: "" })).toBeNull();
  });

  it("a bilingual profile needs BOTH greetings", () => {
    expect(isAssistantProfileReady({ ...ready, greeting_es: "" })).toBe(false);
    expect(assistantProfileGap({ ...ready, greeting_en: " " })).toBe("greeting");
    expect(assistantProfileGap({ ...ready, greeting_en: "", greeting_es: "" })).toBe("greeting");
  });

  // Review: an operator with English written and Spanish blank was told
  // "write the greeting", about a greeting they had written.
  it("a bilingual profile missing ONLY the Spanish greeting names the Spanish greeting", () => {
    expect(assistantProfileGap({ ...ready, greeting_es: "  " })).toBe("spanish_greeting");
  });

  it("a Spanish-only profile missing its greeting is just 'the greeting' (it is the only one)", () => {
    expect(assistantProfileGap({ ...ready, languages: "es", greeting_es: "" })).toBe("greeting");
  });

  it("blank facts are a gap even with every greeting written", () => {
    expect(assistantProfileGap({ ...ready, facts: "   " })).toBe("facts");
    expect(isAssistantProfileReady({ ...ready, facts: "" })).toBe(false);
  });

  it("names the greeting before the facts when both are missing", () => {
    expect(assistantProfileGap({ ...ready, greeting_en: "", facts: "" })).toBe("greeting");
  });

  it("no profile at all is not ready", () => {
    expect(isAssistantProfileReady(null)).toBe(false);
  });
});
