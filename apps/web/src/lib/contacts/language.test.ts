import { describe, it, expect } from "vitest";
import { makeTr } from "@/lib/record/copy";
import { pageLanguageSignal, languageHint, languageView, parseLanguageView, type ContactLanguageFacts } from "./language";

const T0 = "2026-10-01T15:00:00.000Z";
const T1 = "2026-10-03T15:00:00.000Z";
const T2 = "2026-10-05T15:00:00.000Z";
const T3 = "2026-10-07T15:00:00.000Z";
const NONE: ContactLanguageFacts = {
  language: null, language_source: null, language_set_at: null,
  last_language_signal: null, last_language_signal_source: null, last_language_signal_at: null, language_hint_kept_at: null,
};
const set = (over: Partial<ContactLanguageFacts> = {}): ContactLanguageFacts => ({
  ...NONE, language: "es", language_source: "booking", language_set_at: T1,
  last_language_signal: "es", last_language_signal_source: "booking", last_language_signal_at: T1, ...over,
});
const disagreeing = (over: Partial<ContactLanguageFacts> = {}) =>
  set({ last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2, ...over });

describe("pageLanguageSignal (C6, Q2): a page's language counts only when it is not what the customer would get anyway", () => {
  it("Spanish on an English account is a sign (mutation: never count -> FAILS)", () => {
    expect(pageLanguageSignal("es", null)).toBe("es");
    expect(pageLanguageSignal("es", "en")).toBe("es");
  });
  it("English on an English account, or no account language, is nothing (mutation: always count -> FAILS)", () => {
    expect(pageLanguageSignal("en", null)).toBeNull();
    expect(pageLanguageSignal("en", "en")).toBeNull();
  });
  it("English on a Spanish account is a sign; Spanish there is nothing", () => {
    expect(pageLanguageSignal("en", "es")).toBe("en");
    expect(pageLanguageSignal("es", "es")).toBeNull();
  });
});

describe("languageHint (§7.4): four lines, each with the case only it hides", () => {
  it("a later disagreeing sign shows", () => {
    expect(languageHint(disagreeing())).toEqual({ language: "en", source: "call" });
  });
  it("line 1: no language, no hint (mutation: drop it -> FAILS)", () => {
    expect(languageHint({ ...NONE, last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2 })).toBeNull();
  });
  it("line 2: a sign that agrees never shows (mutation: drop `<> language` -> FAILS)", () => {
    expect(languageHint(set({ last_language_signal_at: T2, last_language_signal_source: "call" }))).toBeNull();
  });
  it("line 3: a staff choice made after the sign hides it (mutation: drop `signal_at > set_at` -> FAILS)", () => {
    expect(languageHint(disagreeing({ language_source: "staff", language_set_at: T3 }))).toBeNull();
  });
  it("line 4: Keep hides it until a NEWER sign, which shows it again (mutation: drop the kept test -> FAILS)", () => {
    expect(languageHint(disagreeing({ language_hint_kept_at: T3 }))).toBeNull();
    expect(languageHint(disagreeing({ language_hint_kept_at: T0 }))).toEqual({ language: "en", source: "call" });
  });
});

describe("languageView (§8.2, C8): the line, in the reader's language and the account's zone", () => {
  // A plain default parameter (`= null`) cannot distinguish an explicitly passed
  // `undefined` from an omitted argument — JS applies the default to both — so the
  // "could not be read" case below needs argument-count detection via rest params
  // instead (deviation from the brief's literal helper; same behavior for every
  // other call site, since `args.length === 0` reproduces the old default).
  const view = (c: ContactLanguageFacts, ...args: [("en" | "es" | null)?, ("en" | "es")?]) =>
    languageView(c, {
      accountLanguage: args.length >= 1 ? args[0] : null,
      zone: "America/Chicago",
      tr: makeTr(args.length >= 2 ? args[1]! : "en"),
    });

  it("set: the endonym, then the source and the day in the account's zone (03:00 UTC on Oct 4 is Oct 3 in Chicago)", () => {
    expect(view(set({ language_set_at: "2026-10-04T03:00:00.000Z" }))).toEqual({
      value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null,
    });
  });
  it("each source's phrase, English and Spanish (mutation: one key for every source -> FAILS)", () => {
    const phrases = (["booking", "form", "call", "staff"] as const).map((s) => view(set({ language_source: s })).phrase);
    expect(phrases).toEqual(["from their booking (Oct 3)", "from a form they filled in (Oct 3)", "from a call (Oct 3)", "set by your team (Oct 3)"]);
    expect(view(set(), null, "es").phrase).toBe("por su cita (3 oct)");
  });
  it("not set: English with no account language; the account's language named when it has one; nothing claimed when it could not be read (deviation 10)", () => {
    expect(view(NONE, null).phrase).toBe("Not set. Messages go out in English.");
    expect(view(NONE, "es").phrase).toBe("Not set. Messages go out in Spanish, the account's language.");
    expect(view(NONE, "es", "es").phrase).toBe("Sin definir. Los mensajes salen en español, el idioma de la cuenta.");
    expect(view(NONE, undefined).phrase).toBe("Not set.");
    expect(view(NONE).value).toBeNull();
  });
  it("the hint's words name the sign's source and language (mutation: always the call sentence -> FAILS)", () => {
    expect(view(disagreeing()).hint).toEqual({ language: "en", text: "Spoke English on the last call. Switch to English?" });
    expect(view(disagreeing({ last_language_signal_source: "form" })).hint?.text).toBe("Filled in a form in English last time. Switch to English?");
    expect(view(disagreeing(), null, "es").hint?.text).toBe("En la última llamada habló inglés. ¿Cambiar a inglés?");
  });
});

describe("parseLanguageView: the drawer's body is checked, not cast", () => {
  it("accepts what languageView builds and refuses anything else (mutation: return v as LanguageView -> FAILS)", () => {
    const good = languageView(disagreeing(), { accountLanguage: null, zone: "UTC", tr: makeTr("en") });
    expect(parseLanguageView(JSON.parse(JSON.stringify(good)))).toEqual(good);
    for (const bad of [null, {}, { ...good, value: "fr" }, { ...good, phrase: 3 }, { ...good, hint: { language: "en" } }, { ...good, valueLabel: undefined }]) {
      expect(parseLanguageView(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
