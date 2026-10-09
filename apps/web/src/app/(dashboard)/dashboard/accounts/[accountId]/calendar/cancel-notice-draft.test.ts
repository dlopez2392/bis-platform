import { describe, it, expect } from "vitest";
import { bookingStrings } from "@/lib/booking/public-strings";
import { initialDraft, withLanguage, draftToChoice } from "./cancel-notice-draft";

/**
 * F-048: the Cancel dialog's notice, minus React. The dialog opens only when
 * a notice can go (`cancelStep`), so the draft starts ON; the owner sees the
 * customer's message prefilled in the language they pick, can rewrite it, or
 * can choose not to send it.
 */
const EN = bookingStrings("en").cancelNoticeDefault;
const ES = bookingStrings("es").cancelNoticeDefault;

describe("the Cancel dialog's notice draft (F-048)", () => {
  it("starts on, in English, with the default message", () => {
    expect(initialDraft()).toEqual({ send: true, locale: "en", message: EN });
  });

  it("switching language swaps an untouched message for that language's default (mutation: keep the old text → FAILS)", () => {
    expect(withLanguage(initialDraft(), "es")).toEqual({ send: true, locale: "es", message: ES });
    expect(withLanguage(withLanguage(initialDraft(), "es"), "en").message).toBe(EN);
  });

  it("switching language never throws away what the owner wrote (mutation: always swap → FAILS)", () => {
    const typed = { ...initialDraft(), message: "Our truck broke down." };
    expect(withLanguage(typed, "es")).toEqual({ send: true, locale: "es", message: "Our truck broke down." });
  });

  it("a cleared message takes the new language's default", () => {
    expect(withLanguage({ ...initialDraft(), message: "  " }, "es").message).toBe(ES);
  });

  it("asks the server to send exactly what the owner left (mutation: always send → FAILS)", () => {
    expect(draftToChoice(initialDraft())).toEqual({ send: true, locale: "en", message: EN });
    expect(draftToChoice({ ...initialDraft(), send: false }).send).toBe(false);
  });

  it("the defaults are real sentences in both languages, and differ", () => {
    expect(EN).toMatch(/cancel/i);
    expect(ES).toMatch(/cancelar/i);
    expect(ES).not.toBe(EN);
  });
});
