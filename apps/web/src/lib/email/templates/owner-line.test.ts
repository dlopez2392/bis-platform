import { describe, it, expect } from "vitest";
import { ownerLineLockoutEmail } from "./owner-line";

// Matches the real EmailBrand shape (shell.ts:4-13: name, logoUrl, accent) — the convention voice.test.ts and
// booking.test.ts already use for this fixture, not a `color` field (EmailBrand has none; see this file's own
// report for the plan-vs-source note).
const brand = { name: "Rio Roofing", logoUrl: null, accent: { accent: "#6D28D9", accentForeground: "#ffffff" } };

describe("ownerLineLockoutEmail", () => {
  it("escapes the person's name and keeps one language end to end", () => {
    const e = ownerLineLockoutEmail({ brand, locale: "en", forSelf: false, personName: "<b>Dan</b>", time: "2:14 PM", until: "2:44 PM" });
    expect(e.html).not.toContain("<b>Dan</b>");
    expect(e.text).toContain("from <b>Dan</b>'s phone");
    expect(e.subject).toBe("Someone entered the wrong PIN 3 times");
  });

  it("is forSelf in Spanish, with the account's own time and until in the body (mutation: swap the self/owner body branch -> FAILS)", () => {
    const e = ownerLineLockoutEmail({ brand, locale: "es", forSelf: true, personName: "Dan", time: "2:14 p.m.", until: "2:44 p.m." });
    expect(e.subject).toBe("Alguien marcó el PIN incorrecto 3 veces");
    expect(e.text).toContain("desde su teléfono a las 2:14 p.m.");
    expect(e.text).toContain("hasta las 2:44 p.m.");
    expect(e.text).not.toContain("from your phone");
  });

  it("names a team member with no name on record, in English and Spanish (mutation: drop the ownerNoName branch -> FAILS)", () => {
    const en = ownerLineLockoutEmail({ brand, locale: "en", forSelf: false, personName: null, time: "2:14 PM", until: "2:44 PM" });
    expect(en.text).toContain("from a team member's phone");
    const es = ownerLineLockoutEmail({ brand, locale: "es", forSelf: false, personName: null, time: "2:14 p.m.", until: "2:44 p.m." });
    expect(es.text).toContain("desde el teléfono de alguien de su equipo");
  });

  it("renders the brand name in the html shell, never a hard-coded name", () => {
    const e = ownerLineLockoutEmail({ brand, locale: "en", forSelf: true, personName: "Dan", time: "2:14 PM", until: "2:44 PM" });
    expect(e.html).toContain("Rio Roofing");
  });
});
