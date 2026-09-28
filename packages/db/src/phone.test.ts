import { describe, it, expect } from "vitest";
import { normalisePhone, phoneForCountry, repickPhoneCountry, couldBeMexican } from "./phone";

/**
 * F-009's table (consent chain spec §8, "normalisePhone: a table of US-only,
 * MX-only, both, neither, +52 1, 00 52, carrier-supplied and border-city
 * numbers"). The ten-digit rows are real area codes whose verdicts were
 * measured against libphonenumber-js 1.13.14's max metadata on 2026-09-26
 * (plan, External facts).
 */
describe("normalisePhone: ten digits, judged by country", () => {
  it.each([
    // [label, input, e164, unconfirmed]
    ["McAllen, US only (956)", "(956) 292-1696", "+19562921696", false],
    ["El Paso, US only (915)", "915-234-5678", "+19152345678", false],
    ["Toronto, NANP only (416)", "416 555 0199", "+14165550199", false],
    ["Reynosa, MX only (899)", "899 922 1234", "+528999221234", false],
    ["Matamoros, MX only (868; +1 868 is Trinidad and invalid here)", "8688123456", "+528688123456", false],
    ["Monterrey, MX only (81)", "81 8123 4567", "+528181234567", false],
    ["Juarez, MX only (656)", "656.123.4567", "+526561234567", false],
    ["CDMX 55 is also New Jersey 551: BOTH", "55 1234 5678", "+15512345678", true],
    ["an invalid exchange in 956: NEITHER", "956 123 4567", "+19561234567", true],
    ["junk ten digits: NEITHER", "123-456-7890", "+11234567890", true],
  ])("%s", (_label, input, e164, unconfirmed) => {
    expect(normalisePhone(input)).toEqual({ e164, unconfirmed });
  });
});

describe("normalisePhone: a number with a country code is kept as given", () => {
  it.each([
    ["+1, as a carrier sends it", "+19562921696", "+19562921696"],
    ["+1 of an ambiguous number is NOT flagged: the code is the confirmation", "+15512345678", "+15512345678"],
    ["+52, as a carrier sends it", "+528999221234", "+528999221234"],
    ["+52 1 drops the retired mobile 1", "+52 1 899 922 1234", "+528999221234"],
    ["00 52 (dialled from Mexico)", "00 52 899 922 1234", "+528999221234"],
    ["00 52 1 drops the 1 too", "0052 1 899 922 1234", "+528999221234"],
    ["011 52 (dialled from the US)", "011 52 899 922 1234", "+528999221234"],
    ["1 + ten digits is the NANP trunk prefix", "1 (956) 292-1696", "+19562921696"],
    ["a UK number typed with +", "+44 20 7946 0958", "+442079460958"],
  ])("%s", (_label, input, e164) => {
    expect(normalisePhone(input)).toEqual({ e164, unconfirmed: false });
  });
});

describe("normalisePhone: nothing to text", () => {
  it.each([[""], ["   "], [null], [undefined], ["12345"], ["call me"], ["+0 123 4567 8901"]])("%j → null", (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});

describe("phoneForCountry: a number typed beside a country choice", () => {
  it("ten national digits take the chosen country", () => {
    expect(phoneForCountry("956 292 1696", "US")).toBe("+19562921696");
    expect(phoneForCountry("956 292 1696", "MX")).toBe("+529562921696");
    expect(phoneForCountry("1 956 292 1696", "US")).toBe("+19562921696");
    expect(phoneForCountry("52 1 899 922 1234", "MX")).toBe("+528999221234");
  });

  it("digits that begin with a country code are that country's, never re-read under the other (mutation: strip 52/1 and take the chosen country → a stranger's number, FAILS)", () => {
    expect(phoneForCountry("52 55 1234 5678", "US")).toBeNull();
    expect(phoneForCountry("52 899 922 1234", "US")).toBeNull();
    expect(phoneForCountry("1 956 292 1696", "MX")).toBeNull();
    expect(phoneForCountry("52 55 1234 5678", "MX")).toBe("+525512345678");
  });

  it("a typed country code must agree with the choice (mutation: return the typed E.164 regardless → FAILS)", () => {
    expect(phoneForCountry("+52 899 922 1234", "MX")).toBe("+528999221234");
    expect(phoneForCountry("+52 899 922 1234", "US")).toBeNull();
    expect(phoneForCountry("+1 956 292 1696", "MX")).toBeNull();
    expect(phoneForCountry("011 52 899 922 1234", "MX")).toBe("+528999221234");
    expect(phoneForCountry("+44 20 7946 0958", "US")).toBeNull();
  });

  it("anything that is not ten national digits is null", () => {
    expect(phoneForCountry("", "US")).toBeNull();
    expect(phoneForCountry("12345", "MX")).toBeNull();
  });

  it("a typed + number must carry exactly ten national digits after its country code, or it is refused (review m2; mutation: count nationalTen's bare-ten branch even behind a + → an 8- or 9-digit number reported as valid, FAILS)", () => {
    expect(phoneForCountry("+52 1234 5678", "MX")).toBeNull();
    expect(phoneForCountry("+1 234567890", "US")).toBeNull();
  });
});

describe("repickPhoneCountry: the drawer's country pick re-reads the stored digits", () => {
  it("a +1 reading becomes +52 and back (mutation: keep a stored + as given → the MX pick stays +1, FAILS)", () => {
    expect(repickPhoneCountry("+15512345678", "MX")).toBe("+525512345678");
    expect(repickPhoneCountry("+525512345678", "US")).toBe("+15512345678");
    expect(repickPhoneCountry("(551) 234-5678", "MX")).toBe("+525512345678");
  });

  it("a stored phone that is not a ten-digit reading is refused, never guessed", () => {
    expect(repickPhoneCountry("+442079460958", "US")).toBeNull();
    expect(repickPhoneCountry(null, "MX")).toBeNull();
  });
});

describe("couldBeMexican: the 0054 backfill's test", () => {
  it.each([
    // [label, stored, flagged]
    ["+1 and ten digits valid under +52 (CDMX 55, also NJ 551)", "+15512345678", true],
    ["+1 and a Reynosa number the old toE164 made American", "+18999221234", true],
    ["1 and ten digits, no plus, valid under +52", "1 (899) 922-1234", true],
    ["+1 McAllen, not a Mexican number", "+19562921696", false],
    ["bare ten digits valid under both", "55 1234 5678", true],
    ["bare ten digits valid under neither (a write would flag it too)", "956 123 4567", true],
    ["bare Reynosa: the gate already reads it as +52, no flag", "899 922 1234", false],
    ["bare McAllen", "(956) 292-1696", false],
    ["already +52", "+528999221234", false],
    ["a UK number", "+44 20 7946 0958", false],
    ["blank", "", false],
  ])("%s → %s", (_label, stored, flagged) => {
    expect(couldBeMexican(stored)).toBe(flagged);
  });
});

describe("normalisePhone: Mexico's retired trunk prefixes, and leading zeros", () => {
  it("01, 044 and 045 before ten digits are Mexican (mutation: drop the trunk rule → a +0 number, FAILS)", () => {
    expect(normalisePhone("01 81 8123 4567")).toEqual({ e164: "+528181234567", unconfirmed: false });
    expect(normalisePhone("044 81 8123 4567")).toEqual({ e164: "+528181234567", unconfirmed: false });
    expect(normalisePhone("045 899 922 1234")).toEqual({ e164: "+528999221234", unconfirmed: false });
  });

  it("any other leading 0 is refused, never stored as +0… (mutation: let rule 5 take a leading 0 → FAILS)", () => {
    expect(normalisePhone("0 8123 4567")).toBeNull();
    expect(normalisePhone("0 81 8123 4567 89")).toBeNull();
    expect(normalisePhone("01 956 123 4567")).toBeNull();
  });

  it("a bare ten digits with a leading 0 is refused, never stored as +10… (review m1; mutation: drop the leading-zero guard inside the ten-digit branch → a +10 number, FAILS)", () => {
    expect(normalisePhone("0562921696")).toBeNull();
  });
});

describe("normalisePhone: an extension never becomes another country's number (review I1)", () => {
  it.each([
    // [label, input, e164, unconfirmed]
    ["(415) 555-0100 x2 (mutation: don't strip the extension → +41555501002, Switzerland, FAILS)", "(415) 555-0100 x2", "+14155550100", true],
    ["(956) 292-1696 ext 12 (mutation: don't strip the extension → +956292169612, Myanmar, FAILS)", "(956) 292-1696 ext 12", "+19562921696", false],
    ["212-555-0100 ext 3 (mutation: don't strip the extension → +21255501003, Morocco, FAILS)", "212-555-0100 ext 3", "+12125550100", false],
  ])("%s", (_label, input, e164, unconfirmed) => {
    expect(normalisePhone(input)).toEqual({ e164, unconfirmed });
  });

  it("a trailing digit group that is NOT an extension marker is refused, kept as typed (mutation: strip any trailing digits → +95629216965, Myanmar, FAILS)", () => {
    expect(normalisePhone("956-292-1696 after 5")).toBeNull();
  });

  it("the old broad rule ('any other 8-15 digits') is gone: a bare number that is not a recognised code form is refused, not accepted as international (mutation: restore rule 5 → FAILS)", () => {
    expect(normalisePhone("212555010099")).toBeNull(); // 12 digits, not starting "52"
    expect(normalisePhone("9999999999999")).toBeNull(); // 13 digits, not starting "521"
  });

  it("bare digits that DO match a spec code form still work without a + (unaffected by the I1 fix)", () => {
    expect(normalisePhone("52 899 922 1234")).toEqual({ e164: "+528999221234", unconfirmed: false });
    expect(normalisePhone("52 1 899 922 1234")).toEqual({ e164: "+528999221234", unconfirmed: false });
  });
});
