import { describe, it, expect } from "vitest";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { m } from "@/lib/messages";
import { rolePill, statusPill, languageName, roomCopy, emptyCopy, fill } from "./team-copy";

/**
 * I2 (review fix round): every pseudo-aware function here took a `pseudo`
 * parameter (S-10 T9a), but nothing proved any of them actually READ it —
 * `rolePill` in particular was named directly in the review as a mutation
 * that could ignore `pseudo` and survive. Each test below calls the SAME
 * function twice, pseudo off then on, and checks the padded/bracketed
 * form is exactly what `pseudoLocale` produces from the plain string — a
 * mutation that drops `pseudo` from the internal `makeTr(locale, pseudo)`
 * call (or hard-codes `false`) collapses the two calls to the same output
 * and fails every assertion below.
 */
describe("rolePill (I2, review fix round)", () => {
  it("pads every role label under pseudo, in English and Spanish (mutation: makeTr(locale) with no pseudo arg → FAILS)", () => {
    for (const locale of ["en", "es"] as const) {
      const plain = rolePill(locale, false);
      const padded = rolePill(locale, true);
      for (const role of ["owner", "staff", "technician"] as const) {
        expect(padded[role].label).toBe(pseudoLocale(plain[role].label));
        expect(padded[role].label).not.toBe(plain[role].label);
        // The dot/chip tokens are layout, never copy — pseudo must never
        // touch them.
        expect(padded[role].dot).toBe(plain[role].dot);
        expect(padded[role].chip).toBe(plain[role].chip);
      }
    }
  });

  it("defaults to no padding at all when pseudo is omitted (unaffected baseline)", () => {
    expect(rolePill("en").owner.label).toBe(m["team.role.owner"]);
  });
});

describe("statusPill (I2, review fix round)", () => {
  it("pads both status labels under pseudo (mutation: ignore pseudo → FAILS)", () => {
    const plain = statusPill("es", false);
    const padded = statusPill("es", true);
    expect(padded.active.label).toBe(pseudoLocale(plain.active.label));
    expect(padded.invited.label).toBe(pseudoLocale(plain.invited.label));
  });
});

describe("languageName (I2, review fix round)", () => {
  it("pads both language names under pseudo (mutation: ignore pseudo → FAILS)", () => {
    const plain = languageName("en", false);
    const padded = languageName("en", true);
    expect(padded.en).toBe(pseudoLocale(plain.en));
    expect(padded.es).toBe(pseudoLocale(plain.es));
  });
});

describe("roomCopy (I2, review fix round)", () => {
  it("pads the owner's 'room for N more' line under pseudo (mutation: ignore pseudo → FAILS)", () => {
    const plain = roomCopy(3, "owner", "en", false);
    const padded = roomCopy(3, "owner", "en", true);
    expect(padded).toBe(pseudoLocale(plain!));
  });

  it("pads the singular 'room for 1 more' line under pseudo", () => {
    const plain = roomCopy(1, "owner", "en", false);
    const padded = roomCopy(1, "owner", "en", true);
    expect(padded).toBe(pseudoLocale(plain!));
  });

  it("pads the full-room line, for both viewers, under pseudo", () => {
    for (const viewer of ["owner", "agency"] as const) {
      const plain = roomCopy(0, viewer, "en", false);
      const padded = roomCopy(0, viewer, "en", true);
      expect(padded).toBe(pseudoLocale(plain!));
    }
  });

  it("null (no cap known) stays null under pseudo too — nothing to pad (mutation: pad null into \"[null]\" → FAILS)", () => {
    expect(roomCopy(null, "owner", "en", true)).toBeNull();
  });
});

describe("emptyCopy (I2, review fix round)", () => {
  it("pads the owner's 'just you so far' line under pseudo (mutation: ignore pseudo → FAILS)", () => {
    const plain = emptyCopy("owner", 1, 0, false, "en", false);
    const padded = emptyCopy("owner", 1, 0, false, "en", true);
    expect(padded).toBe(pseudoLocale(plain!));
  });

  it("pads the agency's empty-team line under pseudo", () => {
    const plain = emptyCopy("agency", 0, 0, false, "en", false);
    const padded = emptyCopy("agency", 0, 0, false, "en", true);
    expect(padded).toBe(pseudoLocale(plain!));
  });

  it("stays null under pseudo when Clerk is unavailable or an invite is pending — nothing to pad (mutation: pad null → FAILS)", () => {
    expect(emptyCopy("owner", 1, 0, true, "en", true)).toBeNull();
    expect(emptyCopy("owner", 1, 1, false, "en", true)).toBeNull();
  });
});

describe("fill (unaffected by pseudo — it has no locale/pseudo parameter at all)", () => {
  it("substitutes a hole with a replacer function, never a string pattern (mutation: use String.replace's string form → a name containing \"$&\" garbles, FAILS)", () => {
    expect(fill("Room for {count} more", { count: 3 })).toBe("Room for 3 more");
  });
});
