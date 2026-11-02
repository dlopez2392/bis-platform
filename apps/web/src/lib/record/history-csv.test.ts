import { describe, it, expect } from "vitest";
import { historyCsvHeader, toHistoryCsv, type HistoryCsvRow } from "./history-csv";

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

  it("quotes a cell carrying a comma, a quote or a newline, doubling an inner quote", () => {
    const csv = toHistoryCsv("en", [row({ who: 'Ana "Ani" Cruz, Jr.' })]);
    const dataLine = csv.split("\n")[1]!;
    expect(dataLine).toContain('"Ana ""Ani"" Cruz, Jr."');
  });

  it("an empty row set is the header alone", () => {
    expect(toHistoryCsv("en", [])).toBe("When,Who,Kind,Record,Field,Before,After,Cause");
  });
});
