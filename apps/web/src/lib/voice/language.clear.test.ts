import { describe, it, expect } from "vitest";
import type { TranscriptEvent } from "@bis/db";
import { clearCallerLanguage, clearCallerLanguageNow, detectSpokenLanguage, CLEAR_THRESHOLDS } from "./language";

const caller = (...texts: string[]): TranscriptEvent[] => texts.map((text) => ({ role: "caller", text, at: "t" }));

describe("clearCallerLanguage (S-09 C5): the caller's own words, read strictly, the profile ignored", () => {
  it("two Spanish markers with a majority read Spanish, whatever the line's profile (mutation: honour the profile as detectSpokenLanguage does -> FAILS)", () => {
    const t = caller("hola, necesito una cita");
    expect(detectSpokenLanguage(t, "en")).toBe("en");
    expect(clearCallerLanguage(t)).toBe("es");
  });

  it("a lone 'gracias' is not enough (mutation: esMin 1 -> FAILS)", () => {
    expect(clearCallerLanguage(caller("ok gracias"))).toBeNull();
  });

  it("a tie is unclear, never a default (mutation: return 'en' on a tie as calls.language does -> FAILS)", () => {
    expect(clearCallerLanguage(caller("hola gracias, thank you"))).toBeNull();
  });

  it("three English markers and no Spanish read English", () => {
    expect(clearCallerLanguage(caller("hello, I need an appointment please"))).toBe("en");
  });

  it("code-switching Spanish is never read as English (plan deviation 4; mutation: drop the enRatio test -> 'en' -> FAILS)", () => {
    expect(clearCallerLanguage(caller("hola, I need una cita for you"))).toBeNull();
  });

  it("only the caller's turns count: a bilingual greeting says nothing (mutation: score every role -> FAILS)", () => {
    const t: TranscriptEvent[] = [
      { role: "assistant", text: "Hola, gracias por llamar. Hello, thanks for calling, how can I help you?", at: "t" },
      { role: "caller", text: "yes", at: "t" },
    ];
    expect(clearCallerLanguage(t)).toBeNull();
  });

  it("an empty transcript is unclear", () => {
    expect(clearCallerLanguage([])).toBeNull();
  });

  it("whenever it reads Spanish, the Calls badge on a 'both' line reads Spanish too (spec §7.2: the two never disagree about a Spanish caller)", () => {
    for (const t of [caller("hola, necesito una cita"), caller("buenas tardes, quiero hablar con el señor"), caller("sí, mañana por favor")]) {
      expect(clearCallerLanguage(t)).toBe("es");
      expect(detectSpokenLanguage(t, "both")).toBe("es");
    }
  });

  it("the thresholds are a parameter, so Task 4 can sweep them; the default is the shipped set", () => {
    expect(clearCallerLanguage(caller("ok gracias"), { ...CLEAR_THRESHOLDS, esMin: 1 })).toBe("es");
  });
});

describe("clearCallerLanguageNow (C7): the finished turns plus the one still arriving", () => {
  it("reads the in-flight turn (mutation: ignore pendingCallerTurn -> FAILS)", () => {
    expect(clearCallerLanguageNow({ transcript: caller("hola"), pendingCallerTurn: { text: "necesito una cita" } })).toBe("es");
    expect(clearCallerLanguageNow({ transcript: caller("hola"), pendingCallerTurn: null })).toBeNull();
  });
});
