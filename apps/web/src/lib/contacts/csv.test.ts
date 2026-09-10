import { describe, expect, it } from "vitest";
import { autoMap, mapRows } from "./csv";
import { CSV_COLUMNS } from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route";

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
});
