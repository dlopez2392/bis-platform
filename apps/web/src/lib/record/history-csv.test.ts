import { describe, it, expect } from "vitest";
import { historyCsvHeader, toHistoryCsv, isoWithOffset, historyFilenameSlug, toHistoryCsvRow, type HistoryCsvRow } from "./history-csv";
import type { ChangeRow } from "@bis/db";

/**
 * F-115 part 1 (S-04), Task 8 Step 1: the pure half of the history download — building the CSV text
 * from already-formatted cells (When/Who/Kind/Record/Field/Before/After/Cause). Row-value formatting
 * (phones, "(blank)", field labels…) is the reader's own job (plan Task 5's text); this module only
 * builds the header in the reader's locale and escapes cells the way the contacts export already does.
 */
function row(over: Partial<HistoryCsvRow> = {}): HistoryCsvRow {
  return {
    when: "2026-11-02T09:00:00-06:00", who: "Dan Lopez", kind: "update", record: "Maria Garcia",
    field: "phone", before: "(956) 555-0111", after: "(956) 555-0112", cause: "",
    ...over,
  };
}

describe("historyCsvHeader", () => {
  it("is the eight columns, in the reader's locale (mutation: Spanish header at es -> Cuándo)", () => {
    expect(historyCsvHeader("en")).toBe("When,Who,Kind,Record,Field,Before,After,Cause");
    expect(historyCsvHeader("es")).toBe("Cuándo,Quién,Tipo,Registro,Campo,Antes,Después,Causa");
  });
});

describe("toHistoryCsv", () => {
  it("joins the header and every row's cells in column order", () => {
    const csv = toHistoryCsv("en", [row()]);
    expect(csv).toBe(
      "When,Who,Kind,Record,Field,Before,After,Cause\n" +
      "2026-11-02T09:00:00-06:00,Dan Lopez,update,Maria Garcia,phone,(956) 555-0111,(956) 555-0112,",
    );
  });

  it("guards a cell starting with = + - or @ so it is never read as a formula (mutation: drop the formula guard -> a =HYPERLINK case FAILS)", () => {
    const csv = toHistoryCsv("en", [row({ before: "=HYPERLINK(evil.example)", after: "+1", record: "-1", field: "@x" })]);
    const dataLine = csv.split("\n")[1]!;
    expect(dataLine).toContain("'=HYPERLINK(evil.example)");
    expect(dataLine).not.toMatch(/,=HYPERLINK/);
    expect(dataLine).toContain(",'+1,");
    expect(dataLine).toContain(",'-1,");
    expect(dataLine).toContain(",'@x,");
  });

  it("guards a cell starting with a TAB or a CR too, not just = + - @ (mutation: drop the TAB/CR guard -> FAILS)", () => {
    const TAB = String.fromCharCode(9);
    const CR = String.fromCharCode(13);
    const csv = toHistoryCsv("en", [row({ before: TAB + "=HYPERLINK(evil.example)", after: CR + "+1" })]);
    const dataLine = csv.split(String.fromCharCode(10))[1]!;
    expect(dataLine).toContain("'" + TAB + "=HYPERLINK(evil.example)");
    expect(dataLine).toContain("'" + CR + "+1");
  });

  it("quotes a cell carrying a comma, a quote or a newline, doubling an inner quote", () => {
    const csv = toHistoryCsv("en", [row({ who: 'Ana "Ani" Cruz, Jr.' })]);
    const dataLine = csv.split("\n")[1]!;
    expect(dataLine).toContain('"Ana ""Ani"" Cruz, Jr."');
  });

  it("an empty row set is the header alone", () => {
    expect(toHistoryCsv("en", [])).toBe("When,Who,Kind,Record,Field,Before,After,Cause");
  });
});

/**
 * F-115 part 1 (S-04), Task 8 Step 2: the route's own value formatting — an account-zone timestamp,
 * a filename-safe slug, and the ChangeRow -> HistoryCsvRow mapping — stays here, pure, beside the
 * CSV writer it feeds. The route (not this module) resolves WHO a row's author is and WHAT a row's
 * record is named, and hands those answers in as plain functions, so no field-label or verb copy
 * (PR E's `history.verb.*`/`history.field.*`) needs to exist for this module to build a row.
 */
describe("isoWithOffset", () => {
  it("renders an instant in the given zone, ISO 8601, with that zone's own offset (mutation: always use +00:00 -> FAILS the Chicago case)", () => {
    expect(isoWithOffset("2026-01-15T05:00:00Z", "America/Chicago")).toBe("2026-01-14T23:00:00-06:00");
    expect(isoWithOffset("2026-01-01T00:00:00Z", "UTC")).toBe("2026-01-01T00:00:00+00:00");
  });

  it("follows DST: the same zone reads a different offset in July than in January", () => {
    expect(isoWithOffset("2026-07-04T17:30:00Z", "America/Chicago")).toBe("2026-07-04T12:30:00-05:00");
  });
});

describe("historyFilenameSlug", () => {
  it("lowercases, strips accents and joins words with a single hyphen (mutation: skip the accent strip -> FAILS)", () => {
    expect(historyFilenameSlug("María García")).toBe("maria-garcia");
    expect(historyFilenameSlug("O'Brien & Sons")).toBe("o-brien-sons");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(historyFilenameSlug("  Ana   --  Lopez!! ")).toBe("ana-lopez");
  });

  it("falls back to a non-empty word for a name with nothing slug-able", () => {
    expect(historyFilenameSlug("")).toBe("record");
    expect(historyFilenameSlug("???")).toBe("record");
  });
});

function changeRow(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
    op: "update", field: "phone", before: "(956) 555-0111", after: "(956) 555-0112", xact: "100",
    authorKind: "person", authorId: "user_1", via: null, createdAt: "2026-11-02T15:00:00Z",
    ...over,
  };
}

describe("toHistoryCsvRow", () => {
  it("builds the eight cells from a ChangeRow, the zone, and the caller's own who/record resolvers", () => {
    const row = toHistoryCsvRow(
      changeRow(), "America/Chicago",
      (r) => `name-of-${r.contactId}`,
      (kind, id) => `${kind}:${id}`,
    );
    expect(row).toEqual({
      when: "2026-11-02T09:00:00-06:00", who: "person:user_1", kind: "contact", record: "name-of-c1",
      field: "phone", before: "(956) 555-0111", after: "(956) 555-0112", cause: "",
    });
  });

  it("a null authorKind reads as automation, never a sixth kind (mutation: pass row.authorKind through unchanged -> FAILS)", () => {
    const row = toHistoryCsvRow(changeRow({ authorKind: null, authorId: null }), "UTC", () => "x", (kind, id) => `${kind}:${id ?? "null"}`);
    expect(row.who).toBe("automation:null");
  });

  it("a null or undefined before/after is blank, never the string 'null'", () => {
    const row = toHistoryCsvRow(changeRow({ before: null, after: null }), "UTC", () => "x", () => "y");
    expect(row.before).toBe("");
    expect(row.after).toBe("");
  });

  it("an object value (an insert's whole-row snapshot) is rendered as JSON, not [object Object]", () => {
    const row = toHistoryCsvRow(
      changeRow({ op: "insert", field: null, before: null, after: { first_name: "Ana", phone: null } }),
      "UTC", () => "x", () => "y",
    );
    expect(row.after).toBe('{"first_name":"Ana","phone":null}');
    expect(row.field).toBe("");
  });

  it("a null via is a blank Cause cell, never the string 'null'", () => {
    expect(toHistoryCsvRow(changeRow({ via: null }), "UTC", () => "x", () => "y").cause).toBe("");
  });

  it("a via carries straight through as the Cause cell", () => {
    expect(toHistoryCsvRow(changeRow({ via: "merge:42" }), "UTC", () => "x", () => "y").cause).toBe("merge:42");
  });
});
