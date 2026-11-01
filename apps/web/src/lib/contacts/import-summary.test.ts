import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { NO_IMPORT_YET, addImportBatch, importBusinessNotes, doneLine, flaggedLine } from "./import-summary";

/**
 * Final review I-C: applyImportBatch reports business names it could not save
 * (too long, or the group write failed after the contacts committed). The
 * wizard's done screen sums every batch and says so in plain words, never
 * "company", and only reports a number it actually received.
 */
describe("addImportBatch sums every batch (mutation: keep only the last batch's business counts -> FAILS)", () => {
  it("adds the counts and the too-long names, and remembers any failed link", () => {
    const t = [
      { created: 2, updated: 1, flagged: 0, businessTooLong: 2 },
      { created: 0, updated: 3, flagged: 1, businessLinkFailed: true },
      { created: 1, updated: 0, flagged: 0, businessTooLong: 1 },
    ].reduce(addImportBatch, NO_IMPORT_YET);
    expect(t).toEqual({ created: 3, updated: 4, flagged: 1, businessTooLong: 3, businessLinkFailed: true });
  });
  it("a run with nothing to report stays at zero and false", () => {
    expect(addImportBatch(NO_IMPORT_YET, { created: 5, updated: 0, flagged: 0 }))
      .toEqual({ created: 5, updated: 0, flagged: 0, businessTooLong: 0, businessLinkFailed: false });
  });
});

describe("importBusinessNotes says what did not save (mutation: drop either line -> FAILS)", () => {
  const base = { created: 1, updated: 0, flagged: 0 };
  it("nothing to say when every business name saved", () => {
    expect(importBusinessNotes({ ...base, businessTooLong: 0, businessLinkFailed: false }, "en")).toEqual([]);
  });
  it("names the too-long count, with its singular, and the retry line", () => {
    expect(importBusinessNotes({ ...base, businessTooLong: 3, businessLinkFailed: true }, "en")).toEqual([
      "3 business names were too long to save (120 characters max).",
      "Business names didn't save for some rows — import again to retry.",
    ]);
    expect(importBusinessNotes({ ...base, businessTooLong: 1, businessLinkFailed: false }, "en"))
      .toEqual(["1 business name was too long to save (120 characters max)."]);
  });
  it("speaks Spanish from the .es twins", () => {
    expect(importBusinessNotes({ ...base, businessTooLong: 2, businessLinkFailed: true }, "es")).toEqual([
      m["contacts.import.businessTooLong.es"].replace("{count}", "2"),
      m["contacts.import.businessLinkFailed.es"],
    ]);
  });
  it("never says company, in either language", () => {
    for (const k of ["contacts.import.businessTooLong", "contacts.import.businessTooLongOne", "contacts.import.businessLinkFailed"] as const) {
      expect(m[k]).not.toMatch(/compan/i);
      expect(m[`${k}.es`]).not.toMatch(/compañ/i);
    }
  });
});

// S-10 leftovers (#317 follow-up, item 5, the review's own "Se agregaron 1" wording finding):
// created and updated are independent counts, each needing its OWN singular/plural agreement —
// a single two-placeholder sentence cannot say "Se agregó 1" (singular) and "se actualizaron 3"
// (plural) in one template.
describe("doneLine: created and updated each agree with their OWN count (mutation: build one template with both placeholders -> FAILS)", () => {
  it("both plural in English and Spanish", () => {
    expect(doneLine({ created: 2, updated: 3, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "en"))
      .toBe("Added 2, updated 3.");
    expect(doneLine({ created: 2, updated: 3, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe("Se agregaron 2, se actualizaron 3.");
  });

  it("created singular, updated plural: the Spanish verb for EACH clause agrees with its own count (mutation: reuse the plural Spanish verb for a singular count -> FAILS)", () => {
    expect(doneLine({ created: 1, updated: 3, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe("Se agregó 1, se actualizaron 3.");
  });

  it("created plural, updated singular: the other way around", () => {
    expect(doneLine({ created: 3, updated: 1, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe("Se agregaron 3, se actualizó 1.");
  });

  it("both singular", () => {
    expect(doneLine({ created: 1, updated: 1, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe("Se agregó 1, se actualizó 1.");
    expect(doneLine({ created: 1, updated: 1, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "en"))
      .toBe("Added 1, updated 1.");
  });

  it("zero reads as the plural/'other' form in both languages, same as today's English", () => {
    expect(doneLine({ created: 0, updated: 5, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe("Se agregaron 0, se actualizaron 5.");
  });
});

describe("flaggedLine: the flagged count agrees at 1, in both languages (mutation: always use the plural Spanish form -> FAILS)", () => {
  it("null (shown only when non-zero, as the wizard today)", () => {
    expect(flaggedLine({ created: 1, updated: 0, flagged: 0, businessTooLong: 0, businessLinkFailed: false }, "en")).toBeNull();
  });
  it("the plural form for more than one, in both languages", () => {
    expect(flaggedLine({ created: 1, updated: 0, flagged: 3, businessTooLong: 0, businessLinkFailed: false }, "en"))
      .toBe("3 possible duplicates flagged for review.");
    expect(flaggedLine({ created: 1, updated: 0, flagged: 3, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe(m["contacts.import.flagged.es"].replace("{flagged}", "3"));
  });
  it("the singular form at exactly 1, in both languages", () => {
    expect(flaggedLine({ created: 1, updated: 0, flagged: 1, businessTooLong: 0, businessLinkFailed: false }, "en"))
      .toBe(m["contacts.import.flaggedOne"]);
    expect(flaggedLine({ created: 1, updated: 0, flagged: 1, businessTooLong: 0, businessLinkFailed: false }, "es"))
      .toBe(m["contacts.import.flaggedOne.es"]);
    expect(m["contacts.import.flaggedOne.es"]).not.toBe(m["contacts.import.flagged.es"].replace("{flagged}", "1"));
  });
});
