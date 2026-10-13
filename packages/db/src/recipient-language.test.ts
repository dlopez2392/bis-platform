import { describe, it, expect } from "vitest";
import { recipientLanguage, chooseBody, spanishIsStale, nextSpanishBox } from "./messaging";

/** S-09 PR 2, spec §10.2, §12.3, C11-C14. Pure: no database (global-setup still runs for the package). */
const D = { en: "Our English.", es: "Nuestro español." };

describe("recipientLanguage (L3, C12)", () => {
  it("the contact's, else the account's, else English (mutation: account before contact -> FAILS)", () => {
    expect(recipientLanguage("en", "es")).toBe("en");
    expect(recipientLanguage("es", "en")).toBe("es");
    expect(recipientLanguage(null, "es")).toBe("es");
    expect(recipientLanguage(undefined, null)).toBe("en");
  });
  it("a stored value outside en/es is not a language (mutation: return contactLanguage as-is -> FAILS)", () => {
    expect(recipientLanguage("fr", null)).toBe("en");
    expect(recipientLanguage("fr", "es")).toBe("es");
    expect(recipientLanguage(null, "pt")).toBe("en");
  });
});

describe("chooseBody (C11, C13)", () => {
  it("English: theirs trimmed, else ours", () => {
    expect(chooseBody({ language: "en", body: "  Theirs.  ", bodyEs: "Suyo.", defaults: D })).toEqual({ language: "en", text: "Theirs." });
    expect(chooseBody({ language: "en", body: "   ", bodyEs: "Suyo.", defaults: D })).toEqual({ language: "en", text: "Our English." });
  });
  it("Spanish: null is our Spanish (mutation: null -> English -> FAILS)", () => {
    expect(chooseBody({ language: "es", body: "Theirs.", bodyEs: null, defaults: D })).toEqual({ language: "es", text: "Nuestro español." });
  });
  it("Spanish emptied: the WHOLE message switches to English, not just the body (mutation: return language 'es' -> FAILS)", () => {
    expect(chooseBody({ language: "es", body: " Theirs. ", bodyEs: "  ", defaults: D })).toEqual({ language: "en", text: "Theirs." });
    expect(chooseBody({ language: "es", body: "", bodyEs: "", defaults: D })).toEqual({ language: "en", text: "Our English." });
  });
  it("Spanish written: theirs, trimmed", () => {
    expect(chooseBody({ language: "es", body: "x", bodyEs: "  Suyo.  ", defaults: D })).toEqual({ language: "es", text: "Suyo." });
  });
});

describe("spanishIsStale (§12.3, C14)", () => {
  it("emptied never warns (mutation: drop the first line -> FAILS)", () => {
    expect(spanishIsStale({ body: "New English.", bodyEs: "", bodyEsBasis: null })).toBe(false);
  });
  it("our English beside our Spanish never warns (mutation: drop the second line -> FAILS)", () => {
    expect(spanishIsStale({ body: "  ", bodyEs: null, bodyEsBasis: null })).toBe(false);
  });
  it("a custom English beside our Spanish warns until someone writes Spanish or ticks the box", () => {
    expect(spanishIsStale({ body: "Custom.", bodyEs: null, bodyEsBasis: null })).toBe(true);
    expect(spanishIsStale({ body: "Custom.", bodyEs: null, bodyEsBasis: "Custom." })).toBe(false);
  });
  it("a written Spanish beside a later English warns; beside its own English it does not (mutation: compare bodyEs with body -> FAILS)", () => {
    expect(spanishIsStale({ body: "New.", bodyEs: "Viejo.", bodyEsBasis: "Old." })).toBe(true);
    expect(spanishIsStale({ body: "Old.", bodyEs: "Viejo.", bodyEsBasis: "Old." })).toBe(false);
  });
  it("a whitespace-only box is emptied, not written (mutation: compare bodyEs === '' literally -> FAILS)", () => {
    expect(spanishIsStale({ body: "New English.", bodyEs: "   ", bodyEsBasis: null })).toBe(false);
  });
  it("trimming differences between callers can't cause a false permanent warning (mutation: compare without trimming -> FAILS)", () => {
    expect(spanishIsStale({ body: "Same.  ", bodyEs: "Viejo.", bodyEsBasis: "Same." })).toBe(false);
    expect(spanishIsStale({ body: "Same.", bodyEs: "Viejo.", bodyEsBasis: "Same.  " })).toBe(false);
  });
});

describe("nextSpanishBox (C13 on save, §12.3's basis rule, plan deviation 3)", () => {
  const base = { useOurs: false, stillMatches: false, defaultEs: "Nuestro español.", body: "New English." };
  it("a box equal to our default stores null, and the basis does not move (mutation: store the literal -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, submitted: " Nuestro español. ", stored: { bodyEs: null, basis: "Old English." } }))
      .toEqual({ bodyEs: null, basis: "Old English." });
  });
  it("a changed Spanish moves the basis to the new English (mutation: never move it -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, submitted: "Suyo nuevo.", stored: { bodyEs: "Suyo.", basis: "Old English." } }))
      .toEqual({ bodyEs: "Suyo nuevo.", basis: "New English." });
  });
  it("an English-only edit leaves the basis, so the Spanish goes stale (mutation: always move it -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, submitted: "Suyo.", stored: { bodyEs: "Suyo.", basis: "Old English." } }))
      .toEqual({ bodyEs: "Suyo.", basis: "Old English." });
  });
  it("'The Spanish still matches' moves the basis without changing the Spanish", () => {
    expect(nextSpanishBox({ ...base, stillMatches: true, submitted: "Suyo.", stored: { bodyEs: "Suyo.", basis: "Old English." } }))
      .toEqual({ bodyEs: "Suyo.", basis: "New English." });
  });
  it("an emptied box stores '' (emptied, C13)", () => {
    expect(nextSpanishBox({ ...base, submitted: "   ", stored: { bodyEs: null, basis: null } }))
      .toEqual({ bodyEs: "", basis: "New English." });
  });
  it("F1: with an EMPTY default, a stored '' survives an unrelated save (mutation: test the default before 'unchanged' -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, defaultEs: "", submitted: "", stored: { bodyEs: "", basis: null } }))
      .toEqual({ bodyEs: "", basis: null });
  });
  it("F1: Use our Spanish stores null even when our default is empty, and the basis does not move (mutation: ignore useOurs -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, defaultEs: "", useOurs: true, submitted: "", stored: { bodyEs: "", basis: null } }))
      .toEqual({ bodyEs: null, basis: null });
  });
  it("A1: a Q1 row, custom English, saved with our (non-empty) Spanish default — null, basis unmoved, and now stale (mutation: old basis rule, changed-only -> FAILS)", () => {
    const next = nextSpanishBox({ ...base, submitted: "Nuestro español.", body: "Custom English.", stored: { bodyEs: "", basis: null } });
    expect(next).toEqual({ bodyEs: null, basis: null });
    expect(spanishIsStale({ body: "Custom English.", bodyEs: next.bodyEs, bodyEsBasis: next.basis })).toBe(true);
  });
});
