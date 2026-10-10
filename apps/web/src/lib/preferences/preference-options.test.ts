import { describe, it, expect } from "vitest";
import {
  languageChoicesFor, languageChoiceFrom, languageValueOf, THEME_CHOICES, themeCookieFor, localeOfLanguage,
} from "./preference-options";

describe("language choices", () => {
  it("the agency is offered English and Español only (mutation: return all three for everyone -> FAILS)", () => {
    expect(languageChoicesFor(true)).toEqual(["en", "es"]);
    expect(languageChoicesFor(false)).toEqual(["en", "es", "account"]);
  });

  it("a client's NULL is 'Follow the account'; an agency's NULL checks nothing (mutation: map agency NULL to 'en' -> FAILS)", () => {
    expect(languageChoiceFrom(null, false)).toBe("account");
    expect(languageChoiceFrom(null, true)).toBeNull();
    expect(languageValueOf("account")).toBeNull();
  });

  it("a stored language is that radio for either role, and each radio maps back to its stored value (mutation: return 'account' for every client value -> FAILS)", () => {
    expect(languageChoiceFrom("es", false)).toBe("es");
    expect(languageChoiceFrom("en", true)).toBe("en");
    expect(languageValueOf("es")).toBe("es");
    expect(languageValueOf("en")).toBe("en");
  });
});

describe("the locale a language value speaks", () => {
  it("a choice speaks itself; NULL speaks the account's language, and English when there is none (mutation: ignore the account language -> FAILS)", () => {
    expect(localeOfLanguage("es", "en")).toBe("es");
    expect(localeOfLanguage(null, "es")).toBe("es");
    expect(localeOfLanguage(null, null)).toBe("en");
  });
});

describe("theme choices", () => {
  it("are light, dark and follow my device, in that order (mutation: drop 'system' -> FAILS)", () => {
    expect(THEME_CHOICES).toEqual(["light", "dark", "system"]);
  });

  it("the cookie the server reads: light/dark as chosen, the device's answer for 'system', and cleared for NULL (mutation: write 'system' literally -> FAILS)", () => {
    expect(themeCookieFor("light", true)).toBe("light");
    expect(themeCookieFor("dark", false)).toBe("dark");
    expect(themeCookieFor("system", true)).toBe("dark");
    expect(themeCookieFor("system", false)).toBe("light");
    expect(themeCookieFor(null, true)).toBeNull();
  });
});
