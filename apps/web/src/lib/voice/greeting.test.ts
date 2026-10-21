import { describe, it, expect } from "vitest";
import { openingGreeting } from "./greeting";

const EN = "Hi, thanks for calling Rio Roofing.";
const ES = "Hola, gracias por llamar a Rio Roofing.";
const OFF = { disclose: false, personaName: "Sofía" } as const;
const profile = (languages: "en" | "es" | "both", greeting_en = EN, greeting_es = ES) =>
  ({ languages, greeting_en, greeting_es });

describe("openingGreeting — single-language lines are unchanged", () => {
  it("en: the English greeting, trimmed, in the instruction the route has always sent", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", OFF).instruction)
      .toBe(`Greet the caller with exactly: ${EN}`);
  });

  it("es: the Spanish greeting, trimmed", () => {
    expect(openingGreeting(profile("es"), "Rio Roofing Co", OFF).instruction)
      .toBe(`Greet the caller with exactly: ${ES}`);
  });

  it("blank greetings fall back in the line's own language, naming the brand", () => {
    expect(openingGreeting(profile("en", "  "), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Thanks for calling Rio Roofing Co. How can I help you today?");
    expect(openingGreeting(profile("es", EN, ""), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Gracias por llamar a Rio Roofing Co. ¿En qué le puedo ayudar?");
  });
});

// D-037 (owner decision, Option A): a bilingual line opens with BOTH of the
// operator's greetings — English first, then Spanish — each trimmed.
describe("openingGreeting — a bilingual line says both greetings (D-037)", () => {
  it("carries both greetings, trimmed, English before Spanish (mutation: English only → FAILS)", () => {
    const { instruction } = openingGreeting(profile("both"), "Rio Roofing Co", OFF);
    expect(instruction).toContain(`English: "${EN}"`);
    expect(instruction).toContain(`Spanish: "${ES}"`);
    expect(instruction.indexOf(EN)).toBeLessThan(instruction.indexOf(ES));
  });

  it("tells the model not to translate, shorten or merge them", () => {
    const { instruction } = openingGreeting(profile("both"), "Rio Roofing Co", OFF);
    expect(instruction).toContain("word for word");
    expect(instruction).toContain("Do not translate, shorten or combine them.");
  });

  // A `both` profile saved before Setup required both greetings can still
  // carry a blank one: it falls back in ITS language, never drops a half.
  it("a blank half falls back in its own language, naming the brand", () => {
    const noEs = openingGreeting(profile("both", EN, " "), "Rio Roofing Co", OFF).instruction;
    expect(noEs).toContain(`English: "${EN}"`);
    expect(noEs).toContain('Spanish: "Gracias por llamar a Rio Roofing Co. ¿En qué le puedo ayudar?"');
    const noEn = openingGreeting(profile("both", "", ES), "Rio Roofing Co", OFF).instruction;
    expect(noEn).toContain('English: "Thanks for calling Rio Roofing Co. How can I help you today?"');
    expect(noEn).toContain(`Spanish: "${ES}"`);
  });
});

// Review minor 4: an operator's greeting can contain quotation marks. Each
// greeting is quoted as a JSON string, so where one ends and the next label
// begins is never ambiguous to the model.
describe("openingGreeting — greeting boundaries survive quotation marks", () => {
  it("escapes quotes inside a greeting (mutation: plain \"…\" wrapping → FAILS)", () => {
    const en = 'Thanks for calling "Big Al\'s" Roofing.';
    const es = 'Gracias por llamar a "Big Al\'s".';
    const { instruction } = openingGreeting(profile("both", en, es), "Big Al's", OFF);
    expect(instruction).toContain('English: "Thanks for calling \\"Big Al\'s\\" Roofing."');
    expect(instruction).toContain('Spanish: "Gracias por llamar a \\"Big Al\'s\\"."');
  });
});

// Review minor 5: "trimmed", not "verbatim" — said and pinned.
describe("openingGreeting — trims the operator's greeting, nothing else", () => {
  it("drops leading and trailing whitespace and keeps everything between", () => {
    expect(openingGreeting(profile("en", "  Hi,  there.\n"), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Hi,  there.");
  });
});

const ON = { disclose: true, personaName: "Sofía" } as const;

describe("openingGreeting — off is byte-identical to before S-47a", () => {
  it("en, es and both with disclose false equal the pre-S-47a instructions exactly (mutation: append the sentence regardless of disclose → FAILS)", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Hi, thanks for calling Rio Roofing.");
    expect(openingGreeting(profile("es"), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Hola, gracias por llamar a Rio Roofing.");
    expect(openingGreeting(profile("both"), "Rio Roofing Co", OFF).instruction).toBe(
      "Greet the caller with these two greetings, word for word, one right after the other: "
      + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
      + 'English: "Hi, thanks for calling Rio Roofing." Spanish: "Hola, gracias por llamar a Rio Roofing."');
  });
});

describe("openingGreeting — disclose true says the AI sentence after the greeting, in its language (D3)", () => {
  it("en", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", ON).instruction).toBe(
      "Greet the caller with exactly: Hi, thanks for calling Rio Roofing. "
      + "I'm Sofía, an AI assistant. This call is transcribed so the team can follow up.");
  });
  it("es (mutation: use the English sentence for es → FAILS)", () => {
    expect(openingGreeting(profile("es"), "Rio Roofing Co", ON).instruction).toBe(
      "Greet the caller with exactly: Hola, gracias por llamar a Rio Roofing. "
      + "Soy Sofía, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento.");
  });
  it("both: English greeting + English sentence, then Spanish greeting + Spanish sentence (mutation: swap the two sentences → FAILS)", () => {
    expect(openingGreeting(profile("both"), "Rio Roofing Co", ON).instruction).toBe(
      "Greet the caller with these two greetings, word for word, one right after the other: "
      + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
      + 'English: "Hi, thanks for calling Rio Roofing. I\'m Sofía, an AI assistant. This call is transcribed so the team can follow up." '
      + 'Spanish: "Hola, gracias por llamar a Rio Roofing. Soy Sofía, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento."');
  });
  it("names the account's own persona, and falls back to Sofía for a blank one", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", { disclose: true, personaName: "Alex" }).instruction)
      .toContain("I'm Alex, an AI assistant.");
    expect(openingGreeting(profile("en"), "Rio Roofing Co", { disclose: true, personaName: "  " }).instruction)
      .toContain("I'm Sofía, an AI assistant.");
  });
});
