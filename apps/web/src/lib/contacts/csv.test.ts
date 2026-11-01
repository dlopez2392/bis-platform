import { describe, expect, it } from "vitest";
import { autoMap, mapRows, IMPORT_FIELDS, importFieldLabel } from "./csv";
import { CSV_COLUMNS } from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route";
// Aliased: the `mapRows` describe block below already owns the name `m` for its own
// column-mapping fixture (Email -> email, etc.) — the catalogue is `messages` here instead.
import { m as messages } from "@/lib/messages";

describe("autoMap", () => {
  it("matches ignoring case, spaces, underscores and hyphens", () => {
    expect(autoMap(["First Name", "last_name", "E-Mail", "Phone Number"]))
      .toEqual({ "First Name": "first_name", last_name: "last_name",
                 "E-Mail": "email", "Phone Number": "phone" });
  });

  it("leaves a column it cannot place as null rather than guessing", () => {
    expect(autoMap(["Nickname"])).toEqual({ Nickname: null });
  });

  // BINDING (Task 4 review). The export writes a UTF-8 BOM so Excel on Windows
  // renders accented names; fs.readFileSync/Buffer#toString do NOT strip it.
  // The KEY must stay the header as it arrived — the caller looks the mapping
  // up against the parser's own row keys, which carry the BOM too.
  it("ignores a leading BOM when matching, and keys the result by the header as it arrived", () => {
    expect(autoMap(["\uFEFFfirst_name", "email"]))
      .toEqual({ "\uFEFFfirst_name": "first_name", email: "email" });
  });

  it("places every column our own export writes, so a round trip loses nothing", () => {
    expect(autoMap([...CSV_COLUMNS]))
      .toEqual(Object.fromEntries(CSV_COLUMNS.map((c) => [c, c])));
  });

  // The wizard's mapping dropdown renders IMPORT_FIELDS. It is declared in
  // csv.ts rather than imported from the export route, because that route
  // pulls in Clerk and the db client and the wizard is a client component —
  // so this is the pin that stops the two lists drifting apart.
  it("offers exactly the columns the export writes, in the same order", () => {
    expect([...IMPORT_FIELDS]).toEqual([...CSV_COLUMNS]);
  });
});

// S-10 leftovers (#317 follow-up, item 1): the mapping dropdown rendered IMPORT_FIELDS' raw ids
// ("first_name", "company_name", ...) as its OWN option labels, in both languages, since field was
// read straight into JSX with no lookup through the catalogue at all.
describe("importFieldLabel", () => {
  it("gives every IMPORT_FIELDS id a readable English label, never the raw id itself (mutation: return field itself -> FAILS)", () => {
    for (const field of IMPORT_FIELDS) {
      const label = importFieldLabel(field);
      expect(label).not.toBe(field);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("reads Spanish when asked (mutation: ignore the locale param -> FAILS)", () => {
    expect(importFieldLabel("first_name", "es")).toBe(messages["contacts.firstName.es"]);
    expect(importFieldLabel("last_name", "es")).toBe(messages["contacts.lastName.es"]);
    expect(importFieldLabel("email", "es")).toBe(messages["contacts.email.es"]);
    expect(importFieldLabel("phone", "es")).toBe(messages["contacts.phone.es"]);
    expect(importFieldLabel("company_name", "es")).toBe(messages["contact.company.es"]);
    expect(importFieldLabel("source", "es")).toBe(messages["contact.source.label.es"]);
    expect(importFieldLabel("tags", "es")).toBe(messages["contact.tags.es"]);
  });

  it("defaults to English with no locale given", () => {
    expect(importFieldLabel("first_name")).toBe(messages["contacts.firstName"]);
  });
});

describe("mapRows", () => {
  const m = { Email: "email", First: "first_name", Tags: "tags" };

  it("splits tags on commas and trims them", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", First: "Ada", Tags: " vip , lead " } }], m);
    expect(mapped[0]!.tags).toEqual(["vip", "lead"]);
  });

  it("rejects a row with neither email nor phone — nothing could ever match it", () => {
    const { mapped, errors } = mapRows([{ line: 5, values: { First: "Ada" } }], m);
    expect(mapped).toHaveLength(0);
    expect(errors[0]).toEqual({ line: 5, reason: "no email or phone" });
  });

  it("rejects a malformed email but keeps the rest of the file", () => {
    const { mapped, errors } = mapRows([
      { line: 2, values: { Email: "not-an-email", First: "X" } },
      { line: 3, values: { Email: "a@b.co", First: "Y" } },
    ], m);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(2);
    expect(mapped).toHaveLength(1);
  });

  // S-10 leftovers (#317 follow-up, item 4): the skipped-row reasons a person sees after an
  // import (the inline "won't be imported" list and the downloaded skipped-rows.csv) were
  // English-only literals — never routed through the catalogue at all.
  describe("skipped-row reasons in the reader's language", () => {
    it("reads the Spanish reason when asked, for both skip reasons (mutation: ignore the locale param -> FAILS)", () => {
      const { errors: noContact } = mapRows([{ line: 5, values: { First: "Ada" } }], m, "es");
      expect(noContact[0]!.reason).toBe(messages["contacts.import.reason.noEmailOrPhone.es"]);
      const { errors: badEmail } = mapRows([{ line: 2, values: { Email: "not-an-email" } }], m, "es");
      expect(badEmail[0]!.reason).toBe(messages["contacts.import.reason.invalidEmail.es"]);
    });

    it("defaults to the same plain-English reasons as before with no locale given (mutation: change the English default wording -> FAILS)", () => {
      const { errors: noContact } = mapRows([{ line: 5, values: { First: "Ada" } }], m);
      expect(noContact[0]!.reason).toBe("no email or phone");
      const { errors: badEmail } = mapRows([{ line: 2, values: { Email: "not-an-email" } }], m);
      expect(badEmail[0]!.reason).toBe("invalid email");
    });
  });

  it("strips the leading quote our own export adds to a formula-looking cell", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { First: "'=SUM(A1)", Email: "a@b.co" } }], m);
    expect(mapped[0]!.input.firstName).toBe("=SUM(A1)");
  });

  // The export only prefixes a quote when the value starts with = + - or @.
  // Stripping unconditionally would corrupt "'Tis" on every round trip.
  it("leaves a leading apostrophe alone when our export would not have added one", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { First: "'Tis", Email: "a@b.co" } }], m);
    expect(mapped[0]!.input.firstName).toBe("'Tis");
  });

  it("keeps a blank cell OUT of the patch entirely, so it cannot overwrite", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", First: "" } }], m);
    expect("firstName" in mapped[0]!.input).toBe(false);
  });

  it("carries the business BESIDE the patch, never inside it (S-02 §6 row 5; mutation: drop the company_name branch -> FAILS)", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", Business: "  Acme Roofing " } }], { Email: "email", Business: "company_name" });
    expect(mapped[0]!.company).toBe("Acme Roofing");
    expect("companyName" in mapped[0]!.input).toBe(false);
  });

  it("a blank business cell carries nothing, so a re-import can never unlink a business", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", Business: "" } }], { Email: "email", Business: "company_name" });
    expect("company" in mapped[0]!).toBe(false);
  });
});
