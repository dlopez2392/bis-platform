import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { NO_IMPORT_YET, addImportBatch, importBusinessNotes } from "./import-summary";

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
