import { describe, it, expect } from "vitest";
import { makeTr } from "./copy";

describe("makeTr", () => {
  it("reads the Spanish twin for es and counts by Intl plural rules", () => {
    expect(makeTr("es").text("record.action.call")).toBe("Llamar");
    expect(makeTr("en").count("record.facts.booked", 1)).toBe("Booked once");
    expect(makeTr("en").count("record.facts.booked", 3)).toBe("Booked 3 times");
    expect(makeTr("es").count("record.facts.booked", 1)).toBe("Agendó una vez");
  });
  it("pseudo wraps the English string, placeholders already filled (mutation: ignore pseudo -> 'Contacts', FAILS)", () => {
    const s = makeTr("en", true).text("record.back");
    expect(s).not.toBe("Contacts");
    expect(s.length).toBeGreaterThan("Contacts".length);
  });
});
