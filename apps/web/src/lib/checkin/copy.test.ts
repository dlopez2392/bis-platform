import { describe, expect, it } from "vitest";
import { m } from "@/lib/messages";
import { checkinCopy, checkinTaskTitle, stackedLines, thankYouKey } from "./copy";

const KEYS = Object.keys(m).filter((k) => k.startsWith("checkin.") && !k.endsWith(".es"));
const REVIEW_WORDS = /review|reseña|opinión|calific/i;

describe("the check-in's words", () => {
  it("every English string has its Spanish twin, and neither carries template syntax or a milestone code", () => {
    expect(KEYS.length).toBeGreaterThan(20);
    for (const k of KEYS) {
      const en = m[k as keyof typeof m];
      const es = (m as Record<string, string>)[`${k}.es`];
      expect(es, `${k} has no Spanish twin`).toBeTruthy();
      for (const text of [en, es!]) {
        expect(text, k).not.toMatch(/\{\{|\}\}/);
        expect(text, k).not.toMatch(/\bM\d[a-z]?\b/);
      }
    }
  });

  it("nothing the customer reads BEFORE answering mentions a review, in either language (the check-in is never a filter in front of one)", () => {
    for (const lang of ["en", "es"] as const) {
      const tt = checkinCopy(lang, "Rio Roofing");
      for (const key of ["checkin.pageTitle", "checkin.ask.title", "checkin.ask.detail", "checkin.answer.great", "checkin.answer.okay", "checkin.answer.not_great"] as const) {
        expect(tt(key), `${lang} ${key}`).not.toMatch(REVIEW_WORDS);
      }
    }
  });

  it("great and okay get the thank-you sentence, not great gets the apology, both naming the brand and both followed by the review button", () => {
    expect(checkinCopy("en", "Rio Roofing")(thankYouKey("great"))).toBe("Thank you. If you have a minute, a review helps Rio Roofing a lot.");
    expect(thankYouKey("okay")).toBe(thankYouKey("great"));
    expect(checkinCopy("en", "Rio Roofing")(thankYouKey("not_great")))
      .toBe("We're sorry we missed the mark. We've let Rio Roofing know. If you'd still like to leave a review, here is the link.");
    expect(checkinCopy("es", "Rio Roofing")(thankYouKey("great"))).toBe("Gracias. Si tiene un minuto, una reseña ayuda mucho a Rio Roofing.");
  });

  it("an account with no review link gets sentences that do not point at one (the button is omitted, so the words must be too)", () => {
    for (const lang of ["en", "es"] as const) {
      const tt = checkinCopy(lang, "Rio Roofing");
      for (const a of ["great", "okay", "not_great"] as const) {
        const s = tt(thankYouKey(a, false));
        expect(s, `${lang} ${a}`).not.toMatch(REVIEW_WORDS);
        expect(s).not.toMatch(/\{/);
      }
    }
    expect(checkinCopy("en", "Rio Roofing")(thankYouKey("not_great", false))).toBe("We're sorry we missed the mark. We've let Rio Roofing know.");
    expect(checkinCopy("en", null)(thankYouKey("not_great", false))).toBe("We're sorry we missed the mark. We've let the team know.");
    expect(checkinCopy("en", null)(thankYouKey("great", false))).toBe("Thank you.");
  });

  it("an account with no brand name gets whole no-name sentences, never an empty hole", () => {
    for (const lang of ["en", "es"] as const) {
      const tt = checkinCopy(lang, null);
      for (const a of ["great", "okay", "not_great"] as const) {
        const s = tt(thankYouKey(a));
        expect(s, `${lang} ${a}`).not.toMatch(/\{|\s{2}|\s\./);
      }
      expect(tt("checkin.expired.title")).not.toMatch(/\{/);
      expect(tt("checkin.expired.body")).not.toMatch(/\{/);
    }
  });

  it("Spanish is usted: no tuteo in any checkin string", () => {
    for (const k of KEYS) {
      const es = (m as Record<string, string>)[`${k}.es`]!;
      expect(es, k).not.toMatch(/\b(tú|tu|tienes|puedes|toca|llama|quieres|déjanos)\b/i);
    }
  });

  it("stackedLines reads both languages for a page that has no language yet", () => {
    expect(stackedLines("checkin.notValid.title")).toEqual({ en: "This link is not valid.", es: "Este enlace no es válido." });
  });

  it("the To-do title names the customer in the account's language, and has a no-name sentence", () => {
    expect(checkinTaskTitle("en", "Ana García")).toBe("Call Ana García: they said the job was not great");
    expect(checkinTaskTitle("es", "Ana García")).toBe("Llame a Ana García: dijo que el trabajo no estuvo bien");
    expect(checkinTaskTitle("en", "  ")).toBe("Call this customer: they said the job was not great");
  });
});
