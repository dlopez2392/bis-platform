// S-47b, owner ruling B7: the ID-number mask's two tables (re-review R2), every row a typed literal.
import { describe, it, expect } from "vitest";
import type { TranscriptEvent } from "@bis/db";
import { ID_MASK, ID_RULE, maskIdNumbers, maskTranscript } from "./id-mask";

/** [input, output, shape]. */
const MUST_MASK: readonly (readonly [string, string, string])[] = [
  ["my social is 123-45-6789", "my social is [ID number]", "3-2-4"],
  ["mi seguro social es 123 45 6789", "mi seguro social es [ID number]", "3-2-4 spaced, Spanish"],
  ["SSN 123456789.", "SSN [ID number].", "9, sentence end"],
  ["mi seguro social es 1 2 3 4 5 6 7 8 9", "mi seguro social es [ID number]", "digit by digit (9)"],
  ["my license is 12345678", "my license is [ID number]", "8"],
  ["mi licencia es la 1 2 3 4 5 6 7 8", "mi licencia es la [ID number]", "digit by digit (8), Spanish"],
  ["licencia TX12345678", "licencia TX[ID number]", "a letter prefix does not protect it"],
  ["DL 1234 5678", "DL [ID number]", "4-4"],
  ["licencia 1234-5678", "licencia [ID number]", "4-4 hyphen, Spanish"],
  ["12 34 56 78", "[ID number]", "2-2-2-2"],
  ["123 45 67 89", "[ID number]", "3-2-2-2"],
  ["123-456-789", "[ID number]", "3-3-3"],
  ["1, 2, 3, 4, 5, 6, 7, 8, 9", "[ID number]", "comma-space digit by digit"],
  ["123\u201345\u20136789", "[ID number]", "normalised dash (en dashes, U+2013)"],
  ["123\u00A045\u00A06789", "[ID number]", "normalised space (no-break spaces, U+00A0)"],
  ["SSN-123-45-6789", "SSN-[ID number]", "a hyphen after a LETTER does not glue"],
];

/** [input, why]. None carries a Unicode dash or a no-break space, so the normalised input is the input. */
const MUST_NOT: readonly (readonly [string, string])[] = [
  ["call me at 956-292-1696", "phone 3-3-4"],
  ["mi número es 956 292 1696", "phone spaced, Spanish"],
  ["(956) 292-1696", "phone"],
  ["+19562921696", "E.164, 11 digits"],
  ["9562921696", "10 digits"],
  ["nueve: 9 5 6 2 9 2 1 6 9 6", "a phone read digit by digit (10)"],
  ["ZIP 78501", "ZIP"],
  ["el código postal es 78501-1234", "ZIP+4 (5-4 left out)"],
  ["the quote was $1,250.00", "amount"],
  ["salió en 1250 dólares", "amount, Spanish"],
  ["$12345678", "a $ protects even 8 digits"],
  ["March 14, 2027", "date"],
  ["nací el 14 de marzo de 1990", "date, Spanish"],
  ["03/14/2027", "date"],
  ["2027-03-14", "date (4-2-2 left out)"],
  ["14 03 2027", "date (2-2-4 left out)"],
  ["at 10:30", "time"],
  ["a las 10 30", "time, Spanish"],
  ["1-956-292-1696", "phone with country code"],
  ["1 956 292 1696", "phone with country code, spaced"],
  ["95 62 92 16 96", "a phone read in pairs (the not-after space guard)"],
  ["956 29 21 696", "a phone read 3-2-2-3"],
  ["juan12345678@gmail.com", "an email's local part (the @ guard)"],
  ["9, 5, 6, 2, 9, 2, 1, 6, 9, 6", "a phone read digit by digit with commas"],
  ["+52 1 899 123 4567", "a Mexican mobile"],
  ["10 21 2026", "a date read in parts"],
  ["between 2025 2026", "two years (the year-pair guard; owner decision)"],
];

describe("maskIdNumbers: SSN- and licence-shaped numbers become [ID number]", () => {
  it("the tables are the reviewer's 16 and 27 rows, so neither loop can run empty", () => {
    expect(MUST_MASK.length).toBe(16);
    expect(MUST_NOT.length).toBe(27);
  });

  it("the mask and the prompt line are the ruling's words, typed out", () => {
    expect(ID_MASK).toBe("[ID number]");
    expect(ID_RULE).toBe("Never repeat an identification number (SSN, driver's licence, policy number).");
  });

  it.each(MUST_MASK)("masks %j → %j (%s)", (input, output) => {
    expect(maskIdNumbers(input)).toBe(output);
  });

  it.each(MUST_NOT)("leaves %j alone (%s)", (input) => {
    expect(maskIdNumbers(input)).toBe(input);
  });
});

describe("maskTranscript: only the words change", () => {
  it("keeps role and at, masks only text, and leaves the input array untouched", () => {
    const events: TranscriptEvent[] = [
      { role: "assistant", text: "What is your licence number?", at: "2027-06-01T17:00:00.000Z" },
      { role: "caller", text: "my license is 12345678", at: "2027-06-01T17:00:05.000Z" },
    ];
    expect(maskTranscript(events)).toEqual([
      { role: "assistant", text: "What is your licence number?", at: "2027-06-01T17:00:00.000Z" },
      { role: "caller", text: "my license is [ID number]", at: "2027-06-01T17:00:05.000Z" },
    ]);
    expect(events[1]!.text).toBe("my license is 12345678");
  });
});
