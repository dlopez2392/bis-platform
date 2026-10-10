import { describe, it, expect } from "vitest";
import { detectSpokenLanguage, detectCallerLanguage } from "./language";

const t = (texts: string[], role: "caller" | "assistant" = "caller") =>
  texts.map((text) => ({ role, text, at: "2026-08-27T00:00:00.000Z" }));

describe("detectSpokenLanguage", () => {
  it("fixed-language profiles pass through", () => {
    expect(detectSpokenLanguage(t(["hola buenos días"]), "en")).toBe("en");
    expect(detectSpokenLanguage(t(["hello there"]), "es")).toBe("es");
  });
  it("bilingual profile: Spanish caller detected", () => {
    expect(detectSpokenLanguage(
      t(["hola, necesito una cita para mañana por favor"]), "both")).toBe("es");
  });
  it("bilingual profile: English caller detected", () => {
    expect(detectSpokenLanguage(
      t(["hi, I need an appointment for tomorrow please"]), "both")).toBe("en");
  });
  it("only CALLER turns count — an English caller with a bilingual greeting stays en", () => {
    const mixed = [...t(["Gracias por llamar, ¿en qué puedo ayudarle?"], "assistant"),
                   ...t(["yes hi, do you do roof repair?"])];
    expect(detectSpokenLanguage(mixed, "both")).toBe("en");
  });
  it("empty or inconclusive transcript defaults to en (today's behavior)", () => {
    expect(detectSpokenLanguage([], "both")).toBe("en");
    expect(detectSpokenLanguage(t(["ok"]), "both")).toBe("en");
  });
});

// F-010 review m3: the caller's turn can still be in flight when Sofía acts
// on it — the transcription lands after the tool call — so the words heard
// so far count too. Mutation: read `transcript` only → "en", FAILS.
describe("detectCallerLanguage — finished turns plus the one still arriving", () => {
  const pending = (text: string) => ({ itemId: "item_9", text });
  it("a bilingual line reads the in-progress turn when nothing has finished yet", () => {
    expect(detectCallerLanguage(
      { transcript: [], pendingCallerTurn: pending("Hola, quiero hablar con una persona, por favor") }, "both",
    )).toBe("es");
  });
  it("finished turns and the in-progress one are read together", () => {
    // One Spanish marker in each half: each alone is under the two-marker
    // bar and reads English, so only reading BOTH reaches Spanish. Ignoring
    // either half FAILS.
    expect(detectCallerLanguage({ transcript: t(["ok hola"]), pendingCallerTurn: null }, "both")).toBe("en");
    expect(detectCallerLanguage({ transcript: [], pendingCallerTurn: pending("ok gracias") }, "both")).toBe("en");
    expect(detectCallerLanguage({
      transcript: t(["ok hola"]),
      pendingCallerTurn: pending("ok gracias"),
    }, "both")).toBe("es");
  });
  it("no turn at all is English, as before", () => {
    expect(detectCallerLanguage({ transcript: [], pendingCallerTurn: null }, "both")).toBe("en");
  });
  it("a one-language line is that language, and an unset one is English", () => {
    expect(detectCallerLanguage({ transcript: [], pendingCallerTurn: pending("hello") }, "es")).toBe("es");
    expect(detectCallerLanguage({ transcript: [], pendingCallerTurn: null },
      undefined as unknown as "en")).toBe("en");
  });
});
