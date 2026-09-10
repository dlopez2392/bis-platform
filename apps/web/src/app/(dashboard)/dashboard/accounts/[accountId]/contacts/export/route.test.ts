import { describe, expect, it } from "vitest";
import { toCsv, CSV_COLUMNS } from "./route";

describe("contacts CSV", () => {
  it("emits the agreed column order — the import contract depends on it", () => {
    expect(CSV_COLUMNS).toEqual(
      ["first_name", "last_name", "email", "phone", "company_name", "source", "tags"]);
  });

  it("quotes a value containing a comma, a quote or a newline", () => {
    const csv = toCsv([{ first_name: 'A,B', last_name: 'He said "hi"',
      email: "x@y.z", phone: "", company_name: "line1\nline2", source: "", tags: "" }]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"He said ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("never lets a leading =, +, - or @ start a cell (CSV injection into Excel)", () => {
    const csv = toCsv([{ first_name: "=cmd|'/c calc'!A1", last_name: "", email: "",
      phone: "", company_name: "", source: "", tags: "" }]);
    expect(csv).not.toMatch(/(^|,)"?=cmd/);
  });

  it("joins tags with a comma inside one quoted cell", () => {
    expect(toCsv([{ first_name: "A", last_name: "", email: "", phone: "",
      company_name: "", source: "", tags: "vip,lead" }])).toContain('"vip,lead"');
  });
});
