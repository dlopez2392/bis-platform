import { describe, it, expect } from "vitest";
import { factsWarnings } from "./facts-warnings";

const none = { hasHours: false, hasPriceList: false };
describe("hours in Facts (spec 5.3)", () => {
  it.each([
    "Open 8am to 5pm.", "We open at 8:00 a.m.", "Hours 8–5 weekdays.", "Hours 8-5 weekdays.", "Monday 9 to 3",
    "Abrimos de 8 a 5.", "lunes a viernes 9", "Cerramos a las 17:30.", "Sábado 10",
    // Each pattern has a case only it can catch, so dropping any ONE turns this red: a bare 24-hour clock, and
    // "a las" without a colon ("a las 17:30" above is also a 24-hour clock).
    "Open 08:00 to 17:00", "Cerramos a las 5.",
  ])("finds hours in %j: a notice with structured hours, a hint without (mutation: drop that pattern -> FAILS)", (facts) => {
    expect(factsWarnings(facts, "", { hasHours: true, hasPriceList: false }).hours).toBe("notice");
    expect(factsWarnings(facts, "", none).hours).toBe("hint");
  });
  it.each(["Call (956) 292-1696.", "Visit us at 1200 Main St, McAllen TX 78501.", "Since 2026.", "We answer 24/7.", "Licensed, 3 trucks, 2-3 day turnaround."])(
    "does not read %j as hours (mutation: a bare-number pattern -> FAILS)", (facts) => {
      expect(factsWarnings(facts, "", { hasHours: true, hasPriceList: true }).hours).toBeNull();
    });
  it("hours in the Services text are not flagged (Facts only)", () => {
    expect(factsWarnings("", "Open 8am to 5pm", { hasHours: true, hasPriceList: false }).hours).toBeNull();
  });
});

describe("amounts in Facts or Services (C11)", () => {
  it("lists each amount, in order, Facts first, with the words that follow it up to the end of its phrase (mutation: drop the services box -> FAILS)", () => {
    const r = factsWarnings("A $500 deposit to hold the date is due at signing. Catering is $35 per guest.",
      "Cleanings from 40 dólares, or USD 60 for two", { hasHours: false, hasPriceList: true });
    expect(r.amounts.map((a) => [a.source, a.text])).toEqual([
      ["facts", "$500 deposit to hold the date"],
      ["facts", "$35 per guest"],
      ["services", "40 dólares"],
      ["services", "USD 60 for two"],
    ]);
  });
  it("each match's index is the amount's start in its own box", () => {
    const r = factsWarnings("A $500 deposit.", "Cleanings from 40 dólares", { hasHours: false, hasPriceList: true });
    expect(r.amounts.map((a) => [a.source, a.index])).toEqual([["facts", 2], ["services", 15]]);
  });
  it.each(["$40", "$1,200.50 total", "40 dollars", "40 dolares", "40 dólares", "USD 40", "40 USD"])("finds %j", (s) => {
    expect(factsWarnings(s, "", { hasHours: false, hasPriceList: true }).amounts).toHaveLength(1);
  });
  it.each(["Call (956) 292-1696.", "McAllen TX 78501", "Since 2026.", "We answer 24/7.", "Up to 150 guests."])("ignores %j", (s) => {
    expect(factsWarnings(s, "", { hasHours: false, hasPriceList: true }).amounts).toEqual([]);
  });
  it("without a price list there is no amounts flag at all (today's behaviour)", () => {
    expect(factsWarnings("$40 per hour", "", none).amounts).toEqual([]);
  });
});
