import { describe, it, expect } from "vitest";
import { bookingStrings } from "@/lib/booking/public-strings";
import { initialDraft, withLanguage, draftToChoice } from "./cancel-notice-draft";

/**
 * F-048: the Cancel dialog's notice, minus React. The owner sees the
 * customer's message prefilled in the language they pick, can rewrite it, or
 * can choose not to send it at all.
 */
const EN = bookingStrings("en").cancelNoticeDefault;
const ES = bookingStrings("es").cancelNoticeDefault;

describe("the Cancel dialog's notice draft (F-048)", () => {
  it("starts on, in English, with the default message, when the customer has an email", () => {
    expect(initialDraft(true)).toEqual({ send: true, locale: "en", message: EN });
  });

  it("starts off when there is no address to send to (mutation: start on regardless → FAILS)", () => {
    expect(initialDraft(false).send).toBe(false);
  });

  it("switching language swaps an untouched message for that language's default (mutation: keep the old text → FAILS)", () => {
    expect(withLanguage(initialDraft(true), "es")).toEqual({ send: true, locale: "es", message: ES });
    expect(withLanguage(withLanguage(initialDraft(true), "es"), "en").message).toBe(EN);
  });

  it("switching language never throws away what the owner wrote (mutation: always swap → FAILS)", () => {
    const typed = { ...initialDraft(true), message: "Our truck broke down." };
    expect(withLanguage(typed, "es")).toEqual({ send: true, locale: "es", message: "Our truck broke down." });
  });

  it("a cleared message takes the new language's default", () => {
    expect(withLanguage({ ...initialDraft(true), message: "  " }, "es").message).toBe(ES);
  });

  it("asks the server to send only when the owner left it on AND there is an address (mutation: trust the box alone → FAILS)", () => {
    const on = initialDraft(true);
    expect(draftToChoice(on, true)).toEqual({ send: true, locale: "en", message: EN });
    expect(draftToChoice(on, false).send).toBe(false);
    expect(draftToChoice({ ...on, send: false }, true).send).toBe(false);
  });

  it("the defaults are real sentences in both languages, and differ", () => {
    expect(EN).toMatch(/cancel/i);
    expect(ES).toMatch(/cancelar/i);
    expect(ES).not.toBe(EN);
  });
});
