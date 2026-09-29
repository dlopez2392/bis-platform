import { describe, it, expect } from "vitest";
import { matchKeyword, normaliseKeyword, keywordDisplay, CANCEL_WORDS } from "./keywords";

/**
 * Spec decision 10, 11 and choice 26, extended by plan G9: the WHOLE message,
 * ignoring case, accents, spaces, inner hyphens and the punctuation or symbols
 * at either end. Every word of the spec's lists, and the fixed non-matches of
 * spec §8 ("stop by at 3", "Cancel my appointment please", "No").
 */
const STOP_EN = ["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT"];
const STOP_ES = ["PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS"];

describe("matchKeyword — the spec's stop words", () => {
  it.each(STOP_EN)("%s, in upper, lower and title case, is an English stop (mutation: drop any word from the table → FAILS naming it)", (w) => {
    for (const text of [w, w.toLowerCase(), w[0] + w.slice(1).toLowerCase()]) {
      expect(matchKeyword(text)).toMatchObject({ kind: "stop", language: "en" });
    }
  });

  it.each(STOP_ES)("%s, in upper, lower and title case, is a Spanish stop (mutation: drop the accent strip → NO MÁS is missed, FAILS)", (w) => {
    for (const text of [w, w.toLowerCase(), w[0] + w.slice(1).toLowerCase()]) {
      expect(matchKeyword(text)).toMatchObject({ kind: "stop", language: "es" });
    }
  });

  it("the decomposed accent an iPhone sends matches too (mutation: normalise NFC instead of NFD → FAILS)", () => {
    expect(matchKeyword("no ma" + String.fromCharCode(0x301) + "s")).toMatchObject({ kind: "stop", word: "NOMAS", language: "es" });
  });

  it("punctuation and symbols at EITHER end, and inner spaces and hyphens, are ignored (plan G9; mutation: strip only the trailing end → ¡Alto! is missed, FAILS; mutation: keep inner hyphens → Opt-out is missed, FAILS; mutation: drop \\p{Cf} from the edge strip → 'Stop 🤦‍♀️' is missed, FAILS)", () => {
    for (const text of [
      "STOP.", "stop!!!", "Stop 🙏", "  stop  ", "¡Alto!", "¿Baja?", "\"STOP\"", "s t o p", "Opt-out", "no-más",
      // review I1: a ZWJ emoji sequence (face-palm + ZWJ + female sign + variation
      // selector, all in \p{Cf}/\p{M}/\p{S}) trails the word, and a zero-width
      // space (U+200B, \p{Cf}) leads it — both invisible-character classes the
      // edge strip must still eat.
      "Stop \u{1F926}‍♀️", "​STOP",
    ]) {
      expect(matchKeyword(text)?.kind, text).toBe("stop");
    }
  });

  it("the canonical word is what the ledger records, and the drawer prints the spaced forms (mutation: display the canonical form → 'NOMAS' reaches staff, FAILS)", () => {
    expect(matchKeyword("opt out")?.word).toBe("OPTOUT");
    expect(keywordDisplay("OPTOUT")).toBe("OPT OUT");
    expect(keywordDisplay("NOMAS")).toBe("NO MAS");
    expect(keywordDisplay("STOP")).toBe("STOP");
  });

  it("CANCEL and CANCELAR are the two words that also raise the appointment To-do (spec §4.2 step 2; mutation: add END → FAILS)", () => {
    expect([...CANCEL_WORDS].sort()).toEqual(["CANCEL", "CANCELAR"]);
  });
});

describe("matchKeyword — START, UNSTOP, HELP, AYUDA", () => {
  it("START and UNSTOP re-grant; HELP is English help and AYUDA Spanish help (mutation: AYUDA as English → FAILS)", () => {
    expect(matchKeyword("start")).toMatchObject({ kind: "start", word: "START" });
    expect(matchKeyword("Unstop!")).toMatchObject({ kind: "start", word: "UNSTOP" });
    expect(matchKeyword("help?")).toMatchObject({ kind: "help", language: "en" });
    expect(matchKeyword("Ayuda")).toMatchObject({ kind: "help", language: "es" });
  });
});

describe("matchKeyword — what is NOT a keyword", () => {
  it.each([
    "stop by at 3", "Cancel my appointment please", "No", "Stops", "stopp", "end it", "please stop",
    "Yes", "Y", "Si", "Sí", "confirm", "N", "", "   ", "🙏",
  ])("%j is not a keyword: whole message only, and no YES/NO word is one (mutation: match a keyword anywhere in the text → FAILS)", (text) => {
    expect(matchKeyword(text)).toBeNull();
  });

  it("normalises to the matcher's form (the positive control for the table)", () => {
    expect(normaliseKeyword(" ¡No Más! ")).toBe("NOMAS");
  });
});
