import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";

/**
 * F-115 part 1 (S-04), plan Task 8 Step 1: one row of a record's history, already formatted to
 * plain text cells (When/Who/Kind/Record/Field/Before/After/Cause). Row-value formatting — phones,
 * "(blank)", field labels, the "Cause" words for a merge/an AI act/a restore — is the CALLER's job
 * (plan Task 5's text; the route, Task 8 Step 2, builds this from `ChangeRow`/`ChangeGroup` once it
 * exists), so this module stays pure and has no dependency on a database or on PR E landing first.
 */
export type HistoryCsvRow = {
  when: string; who: string; kind: string; record: string; field: string; before: string; after: string; cause: string;
};

const COLUMNS = ["when", "who", "kind", "record", "field", "before", "after", "cause"] as const;
type Column = (typeof COLUMNS)[number];
const HEADER_KEY: Readonly<Record<Column, MessageKey>> = {
  when: "history.csv.when", who: "history.csv.who", kind: "history.csv.kind", record: "history.csv.record",
  field: "history.csv.field", before: "history.csv.before", after: "history.csv.after", cause: "history.csv.cause",
};

/** Copied from `contacts/export/route.ts`'s own (unexported) `guard`/`cell`: a cell starting with
 *  `= + - @` is a formula to Excel and Sheets, so prefixing a single quote defuses it; a cell
 *  carrying a comma, a quote or a newline is wrapped in quotes, doubling any quote inside. */
function guard(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}
function cell(v: string): string {
  const s = guard(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function historyCsvHeader(locale: Locale): string {
  return COLUMNS.map((c) => t(m, HEADER_KEY[c], locale)).join(",");
}

function historyCsvLine(row: HistoryCsvRow): string {
  return COLUMNS.map((c) => cell(row[c])).join(",");
}

export function toHistoryCsv(locale: Locale, rows: readonly HistoryCsvRow[]): string {
  return [historyCsvHeader(locale), ...rows.map(historyCsvLine)].join("\n");
}
