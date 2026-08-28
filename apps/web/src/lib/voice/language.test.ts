import { describe, it, expect } from "vitest";
import { detectSpokenLanguage } from "./language";

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
