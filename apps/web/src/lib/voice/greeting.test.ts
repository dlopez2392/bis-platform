import { describe, it, expect } from "vitest";
import { openingGreeting } from "./greeting";

const EN = "Hi, thanks for calling Rio Roofing.";
const ES = "Hola, gracias por llamar a Rio Roofing.";
const profile = (languages: "en" | "es" | "both", greeting_en = EN, greeting_es = ES) =>
  ({ languages, greeting_en, greeting_es });

describe("openingGreeting — single-language lines are unchanged", () => {
  it("en: the English greeting, verbatim, in the instruction the route has always sent", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co").instruction)
      .toBe(`Greet the caller with exactly: ${EN}`);
  });

  it("es: the Spanish greeting, verbatim", () => {
    expect(openingGreeting(profile("es"), "Rio Roofing Co").instruction)
      .toBe(`Greet the caller with exactly: ${ES}`);
  });

  it("blank greetings fall back in the line's own language, naming the brand", () => {
    expect(openingGreeting(profile("en", "  "), "Rio Roofing Co").instruction)
      .toBe("Greet the caller with exactly: Thanks for calling Rio Roofing Co. How can I help you today?");
    expect(openingGreeting(profile("es", EN, ""), "Rio Roofing Co").instruction)
      .toBe("Greet the caller with exactly: Gracias por llamar a Rio Roofing Co. ¿En qué le puedo ayudar?");
  });
});

// D-037 (owner decision, Option A): a bilingual line opens with BOTH of the
// operator's greetings — English first, then Spanish — each verbatim.
describe("openingGreeting — a bilingual line says both greetings (D-037)", () => {
  it("carries both greetings verbatim, English before Spanish (mutation: English only → FAILS)", () => {
    const { instruction } = openingGreeting(profile("both"), "Rio Roofing Co");
    expect(instruction).toContain(`English: "${EN}"`);
    expect(instruction).toContain(`Spanish: "${ES}"`);
    expect(instruction.indexOf(EN)).toBeLessThan(instruction.indexOf(ES));
  });

  it("tells the model not to translate, shorten or merge them", () => {
    const { instruction } = openingGreeting(profile("both"), "Rio Roofing Co");
    expect(instruction).toContain("word for word");
    expect(instruction).toContain("Do not translate, shorten or combine them.");
  });

  // A `both` profile saved before Setup required both greetings can still
  // carry a blank one: it falls back in ITS language, never drops a half.
  it("a blank half falls back in its own language, naming the brand", () => {
    const noEs = openingGreeting(profile("both", EN, " "), "Rio Roofing Co").instruction;
    expect(noEs).toContain(`English: "${EN}"`);
    expect(noEs).toContain('Spanish: "Gracias por llamar a Rio Roofing Co. ¿En qué le puedo ayudar?"');
    const noEn = openingGreeting(profile("both", "", ES), "Rio Roofing Co").instruction;
    expect(noEn).toContain('English: "Thanks for calling Rio Roofing Co. How can I help you today?"');
    expect(noEn).toContain(`Spanish: "${ES}"`);
  });

  it("text carries both, in order, for anything that reads the greeting as words", () => {
    expect(openingGreeting(profile("both"), "Rio Roofing Co").text).toBe(`${EN} ${ES}`);
  });
});
