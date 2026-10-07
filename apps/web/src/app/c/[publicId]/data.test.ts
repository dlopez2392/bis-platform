import { describe, it, expect } from "vitest";
import { profileLangDefault } from "./data";
import type { ConciergeProfileAnyStatus } from "@bis/db";

const profile = (languages: "en" | "es" | "both"): ConciergeProfileAnyStatus => ({
  account_id: "a1", persona_name: "Sofía", greeting_en: "", greeting_es: "",
  facts: "", services: "", languages, booking_enabled: false,
  after_hours: "message_only", enabled: true, textback_enabled: false,
  textback_body: "", forward_calls: false,
  public_id: "p1", concierge_enabled: false, concierge_form_id: null,
}) as unknown as ConciergeProfileAnyStatus;

describe("profileLangDefault", () => {
  it("reads the profile's own languages, es stays es", () => {
    expect(profileLangDefault(profile("es"))).toBe("es");
  });

  it("'both' and 'en' both fall to en (unchanged from the page's own prior logic)", () => {
    expect(profileLangDefault(profile("en"))).toBe("en");
    expect(profileLangDefault(profile("both"))).toBe("en");
  });

  it("falls back to en when the profile is unknown (null)", () => {
    // MUTATION: default to "es" instead -- this FAILS.
    expect(profileLangDefault(null)).toBe("en");
  });
});
