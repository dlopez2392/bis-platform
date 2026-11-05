import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
// Type-only: a shape, not a runtime dependency on @bis/db — this module stays pure (no database).
import type { ChangeRow, AuthorKind } from "@bis/db";

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

/** Copied from `contacts/export/route.ts`'s own (unexported) `guard`/`cell`, PLUS a TAB or a CR lead
 *  (F-115 PR C fix, review m5): Excel and Sheets still read a formula past a leading TAB or CR, the
 *  same way they do past a leading `= + - @` — a cell starting with any of those six is a formula,
 *  so prefixing a single quote defuses it; a cell carrying a comma, a quote or a newline is wrapped
 *  in quotes, doubling any quote inside. The contacts export route guards the same six
 *  (`contacts/export/route.ts`). */
function guard(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
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

/**
 * F-115 part 1 (S-04), Task 8 Step 2: `row.createdAt` (a timestamptz, already ISO 8601 in UTC) redrawn
 * in the ACCOUNT's own zone, offset and all — so "When" reads the hour the account's own people and
 * customers lived it in, never the server's. `Intl`'s `longOffset` gives "GMT-06:00"/"GMT"; UTC's own
 * "GMT" becomes "+00:00" rather than an empty suffix.
 */
export function isoWithOffset(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const rawOffset = get("timeZoneName");
  const offset = rawOffset === "GMT" ? "+00:00" : rawOffset.replace("GMT", "");
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

/**
 * The filename's own record-name segment: lowercase, accents stripped, every run of anything that
 * is not a-z/0-9 collapsed to one hyphen, no leading or trailing hyphen. "record" when nothing
 * slug-able is left (a name that is empty, or every character something this strips), so the
 * filename never carries a bare "history--2026-11-02.csv" double hyphen.
 */
export function historyFilenameSlug(name: string): string {
  const slug = name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "record";
}

/** Null/undefined is a blank cell; an object (an insert's or non-contact delete's whole-row
 *  snapshot, 0111/0112's `v_old`/`v_new`) is JSON, never the bare "[object Object]" `String()` gives. */
function rawValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * F-115 part 1 (S-04), Task 8 Step 2: one `ChangeRow` (packages/db's `record-changes.ts`) as a CSV
 * row. Deliberately NOT the field-label/verb machinery PR E's `change-rows.ts` owns (Field/Before/
 * After stay the raw column name and raw values; Kind is the raw `recordType`; Cause is the raw
 * `via`) — that copy does not exist yet in this PR, and inventing it here would be this module
 * reaching into PR E's own job. `recordNameOf`/`authorLabelOf` are the route's own DB-backed answers
 * for "whose record is this" and "who made this write", handed in as plain functions so this stays
 * pure and untestable-without-a-database claims stay false. A null `authorKind` (observe mode, before
 * 0113) reads as the automation mark, never a sixth kind — the same fallback `author-mark.ts`'s own
 * "change" case already uses for `ChangeGroup.authorKind`.
 */
export function toHistoryCsvRow(
  row: ChangeRow, zone: string,
  recordNameOf: (row: ChangeRow) => string,
  authorLabelOf: (kind: AuthorKind, authorId: string | null) => string,
): HistoryCsvRow {
  const kind: AuthorKind = row.authorKind ?? "automation";
  return {
    when: isoWithOffset(row.createdAt, zone),
    who: authorLabelOf(kind, row.authorId),
    kind: row.recordType,
    record: recordNameOf(row),
    field: row.field ?? "",
    before: rawValue(row.before),
    after: rawValue(row.after),
    cause: row.via ?? "",
  };
}
