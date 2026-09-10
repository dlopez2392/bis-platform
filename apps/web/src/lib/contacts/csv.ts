import type { ContactInput } from "@bis/db";
import { EMAIL_SHAPE, FIELD_TO_INPUT_KEY } from "./field-input";

/** One parsed CSV record. `line` is the file line the row came from (the
 *  header is line 1), so an error can point the operator at the right row. */
export type ParsedRow = { line: number; values: Record<string, string> };
export type MappedRow = { line: number; input: ContactInput; tags: string[] };
export type RowError = { line: number; reason: string };

/** The ContactInput keys a CSV column can fill. `custom` is deliberately not
 *  reachable from a spreadsheet. */
type InputKey = "firstName" | "lastName" | "email" | "phone" | "companyName" | "source";

/**
 * Column key -> ContactInput key. Spread from the inline editor's own map so
 * the two paths cannot drift; `source` is exported but not inline-editable, so
 * it is added here rather than widening EDITABLE_FIELDS.
 *
 * `tags` is absent on purpose — it is not a ContactInput field and is carried
 * beside the patch, because the import ADDS tags and never clears them.
 */
const FIELD_TO_INPUT: Record<string, InputKey> = {
  ...FIELD_TO_INPUT_KEY,
  source: "source",
};

/**
 * Normalised header -> column key. Deliberately NOT imported from the export
 * route: that module pulls in Clerk and the database client, and Task 7's
 * wizard is a client component, so importing it here would drag server-only
 * code into the browser bundle. The test pins this table against CSV_COLUMNS
 * instead, which catches drift without the import.
 */
const SYNONYMS: Record<string, string> = {
  firstname: "first_name", fname: "first_name", given: "first_name",
  givenname: "first_name",
  lastname: "last_name", lname: "last_name", surname: "last_name",
  family: "last_name", familyname: "last_name",
  email: "email", emailaddress: "email", mail: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", cell: "phone",
  telephone: "phone", tel: "phone",
  company: "company_name", companyname: "company_name",
  organization: "company_name", organisation: "company_name",
  business: "company_name",
  source: "source", leadsource: "source",
  tags: "tags", tag: "tags", label: "tags", labels: "tags",
};

/**
 * A UTF-8 BOM leads the file our own export writes, so Excel on Windows renders
 * accented names. Some readers strip it (Response.text, Blob.text) and some do
 * not (fs.readFileSync, Buffer#toString), so the importer cannot assume: an
 * unstripped BOM makes the first header "\uFEFFfirst_name", which matches
 * nothing and silently drops that whole column.
 *
 * No separate strip for it. U+FEFF is WhiteSpace to ECMAScript, so both `trim`
 * and `\s` already remove it — an explicit `.replace(/^\uFEFF/, "")` here is
 * dead code no mutation can kill, which is worse than none: it advertises
 * coverage that does not exist. The BOM case is pinned by its own test instead,
 * and that test goes red if either whitespace step below is weakened.
 */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * The export prefixes a quote onto a cell starting with = + - or @, so a
 * spreadsheet shows it instead of executing it. Strip it back in exactly that
 * shape and no other — an unconditional strip would eat the apostrophe in a
 * value like "'Tis" on every round trip.
 */
function unguard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function splitTags(value: string): string[] {
  return value.split(",").map((t) => t.trim()).filter((t) => t !== "");
}

/**
 * Guesses which column is which. The returned KEY is the header exactly as it
 * arrived — BOM and all — because the caller looks this mapping up against the
 * parser's own row keys. An unrecognised column maps to null rather than to a
 * guess: dropping a column is recoverable, writing a phone number into the
 * company name is not.
 */
export function autoMap(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  for (const header of headers) {
    mapping[header] = SYNONYMS[normalizeHeader(header)] ?? null;
  }
  return mapping;
}

/**
 * Turns parsed rows into contact patches, dropping the rows nothing could ever
 * be done with. A row is rejected when it carries neither an email nor a phone
 * (no way to match it, and a contact with only a name is noise), or when the
 * email it does carry is malformed. Everything else in the file survives.
 */
export function mapRows(
  rows: ParsedRow[], mapping: Record<string, string | null>,
): { mapped: MappedRow[]; errors: RowError[] } {
  const mapped: MappedRow[] = [];
  const errors: RowError[] = [];

  for (const row of rows) {
    const input: ContactInput = {};
    let tags: string[] = [];

    for (const [header, raw] of Object.entries(row.values)) {
      const field = mapping[header];
      if (!field) continue;

      const value = unguard(String(raw ?? "").trim());
      // A blank cell never reaches the patch. Present-but-empty would null the
      // column, so "export, fix one phone number, re-import" would wipe every
      // other field on every contact in the file.
      if (value === "") continue;

      if (field === "tags") { tags = splitTags(value); continue; }
      const key = FIELD_TO_INPUT[field];
      if (key) input[key] = value;
    }

    if (!input.email && !input.phone) {
      errors.push({ line: row.line, reason: "no email or phone" });
      continue;
    }
    if (input.email && !EMAIL_SHAPE.test(input.email)) {
      errors.push({ line: row.line, reason: "invalid email" });
      continue;
    }

    mapped.push({ line: row.line, input, tags });
  }

  return { mapped, errors };
}
