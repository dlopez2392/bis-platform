import { couldBeMexican } from "../phone";

/**
 * The 0054 phone-country backfill's DECIDING half (consent chain spec §4.1
 * item 1). Pure: the read is supabase/backfills/0054-phone-country-candidates.sql,
 * run by the orchestrator; this turns its rows into the ids to flag and the
 * one UPDATE that flags them. Nothing here connects to a database.
 *
 * The UPDATE is guarded twice: it flags a row only while it is still
 * unflagged AND its phone_key is still the one that was read, so a number
 * edited between the read and the write is left alone (the next write of it
 * flags it through `phoneFields` if it is still ambiguous).
 */
export type CandidateRow = {
  id: string; account_id: string; phone: string; phone_key: string;
  /** `contacts.updated_at`: moves on ANY field's write, so it cannot say who wrote the phone. */
  last_written_at: string;
  /** `contacts.created_at`: never moves. A contact created at or after the cut-off was only ever written by the new build. */
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * `phone_key`'s shape: normally exactly ten digits, but an extension's own
 * digits fold IN (review I5) — "+1 551 234 5613 ext 12" keys at 13, "1 (551)
 * 234-5613 x2" at 12, and a long extension can push it well past 20 (review,
 * re-review: "+1 551 234 5618 ext 1234567890" keys at 21) — so this accepts
 * any digit run of at least ten (the read's own `phone_key ~ '^[0-9]{10,}$'`
 * is the matching bound: an upper cap here would abort the WHOLE run on one
 * legitimate long-extension row, throwing before any output). No upper
 * bound is not a safety loss: digits-only, still anchored both ends (review
 * I2), is what keeps this injection-safe, not the length.
 */
const KEY = /^[0-9]{10,}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COLUMNS = "id,account_id,phone,phone_key,last_written_at,created_at";
/** The only shape the new build stores a number that parses in (`phoneFields`); a ten-digit key always parses. */
const E164 = /^\+[1-9][0-9]{7,14}$/;
/**
 * The CLI's `--cutoff`'s own required shape (review I3): the same UTC-ISO
 * instant `ISO` above requires, but with milliseconds optional (a person
 * typing a cut-off by hand should not have to supply `.000`). Bare `new
 * Date(str)` also accepts a year alone ("2026" → before 2026-01-01Z), a
 * single digit ("1" → before 2001), and a zone-less instant (read in
 * whatever zone the ORCHESTRATOR's machine happens to be in, not UTC) —
 * each a silent, wrong cut-off rather than a refusal.
 */
const CUTOFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/**
 * `CUTOFF`'s shape alone still lets an IMPOSSIBLE calendar date through
 * (coordinator item 2): `new Date("2026-02-30T12:00:00Z")` does not throw or
 * go NaN — V8 rolls it forward to March 2nd, silently. The only way to catch
 * that is to read the date back and compare: `toISOString()` always emits
 * milliseconds, so the input is normalised the same way first (stripping a
 * trailing literal `.000Z` back to `Z`) before the two are compared as text.
 */
function validCutoff(raw: string): Date | null {
  if (!CUTOFF.test(raw)) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  const strip000 = (s: string) => s.replace(/\.000Z$/, "Z");
  return strip000(d.toISOString()) === strip000(raw) ? d : null;
}

function checked(r: Record<string, unknown>, at: string): CandidateRow {
  const { id, account_id, phone, phone_key, last_written_at, created_at } = r;
  if (typeof id !== "string" || !UUID.test(id)) throw new Error(`${at}: id is not a uuid`);
  if (typeof account_id !== "string" || !UUID.test(account_id)) throw new Error(`${at}: account_id is not a uuid`);
  if (typeof phone !== "string") throw new Error(`${at}: phone is not text`);
  if (typeof phone_key !== "string" || !KEY.test(phone_key)) throw new Error(`${at}: phone_key is not at least ten digits`);
  if (typeof last_written_at !== "string" || !ISO.test(last_written_at)) throw new Error(`${at}: last_written_at is not a UTC ISO instant`);
  if (typeof created_at !== "string" || !ISO.test(created_at)) throw new Error(`${at}: created_at is not a UTC ISO instant`);
  return { id, account_id, phone, phone_key, last_written_at, created_at };
}

/**
 * The read's output, as either `execute_sql`'s JSON array or `ci:sql`'s
 * tab-separated text with a header row. THROWS on anything malformed: a
 * backfill that half-understood its input must not emit a write.
 */
export function parseCandidates(text: string): CandidateRow[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) {
    // Never let JSON.parse's own SyntaxError escape (review I7): V8's message
    // for a malformed array embeds a snippet of the input around the error,
    // which can be a customer's phone digits.
    let rows: unknown;
    try {
      rows = JSON.parse(trimmed);
    } catch {
      throw new Error("candidates: not valid JSON");
    }
    if (!Array.isArray(rows)) throw new Error("candidates: not an array");
    return rows.map((r, i) => {
      if (typeof r !== "object" || r === null) throw new Error(`row ${i + 1}: not an object`);
      return checked(r as Record<string, unknown>, `row ${i + 1}`);
    });
  }
  const [header, ...lines] = trimmed.split(/\r?\n/);
  const names = header!.split("\t");
  if (names.join(",") !== COLUMNS) {
    // Never echo the actual header/first line (review I7): if the input is a
    // JSON object routed here by mistake, or a headerless TSV, that line IS
    // the data — id, phone, phone_key and all.
    throw new Error(`candidates: header does not match the read's columns (expected ${COLUMNS})`);
  }
  return lines.filter((l) => l.trim() !== "").map((l, i) => {
    const cells = l.split("\t");
    if (cells.length !== 6) throw new Error(`line ${i + 2}: ${cells.length} cells, expected 6`);
    return checked({ id: cells[0], account_id: cells[1], phone: cells[2], phone_key: cells[3], last_written_at: cells[4], created_at: cells[5] }, `line ${i + 2}`);
  });
}

/**
 * Who wrote each number, decided by what can actually be known.
 * `updated_at` cannot say it: it moves on a write to ANY field (a name
 * edit, `fillContactBlanks`, the opt-out switch), so an old build's
 * `+15512345678` renamed after the deploy would look new and be dropped.
 * Two facts do say it:
 *   - `created_at` never moves: a contact created at or after the cut-off
 *     (the new deploy's READY instant, plus Skew Protection's maximum age
 *     if it is on) was only ever written by the new build;
 *   - the new build stores every number that parses as E.164, and ten digits
 *     always parse, so a phone NOT in E.164 shape was the old build's.
 * `flag`: created before the cut-off, OR stored in a shape the new build
 * never writes. A row created before the cut-off whose PHONE the new build
 * rewrote since (an explicit `+1` a person typed) is flagged too: that
 * cannot be told from a name edit, and the flag only asks staff to confirm
 * the country once. `writtenAfter`: the flagged rows last written after
 * the cut-off, reported on their own. `newBuild`: created after the
 * cut-off and stored as E.164, the new build's own reading (it flags every
 * number that reads both ways, and stores an unflagged `+1` only for a
 * code typed, said or given by the carrier): NOT flagged, but counted and
 * listed by id in the report, never silently dropped.
 */
export function byWriter(rows: readonly CandidateRow[], cutoff: Date): {
  flag: CandidateRow[]; writtenAfter: CandidateRow[]; newBuild: CandidateRow[];
} {
  if (!Number.isFinite(cutoff.getTime())) throw new Error("byWriter: the cut-off is not a date");
  const at = cutoff.getTime();
  const flag: CandidateRow[] = [];
  const newBuild: CandidateRow[] = [];
  for (const r of rows) {
    if (Date.parse(r.created_at) < at || !E164.test(r.phone)) flag.push(r);
    else newBuild.push(r);
  }
  return { flag, writtenAfter: flag.filter((r) => Date.parse(r.last_written_at) >= at), newBuild };
}

/** The rows whose number could be Mexican: the ones to flag. */
export function rowsToFlag(rows: readonly CandidateRow[]): CandidateRow[] {
  return rows.filter((r) => couldBeMexican(r.phone));
}

/** Per account, how many: what the orchestrator reads out before any write. */
export function countByAccount(rows: readonly CandidateRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1);
  return counts;
}

/**
 * Reads the CLI's own argv (see phone-country-run.ts's usage line):
 * `<candidates-file> --cutoff <ISO> [--emit-sql <out.sql>]`. Pure, so the
 * bug the required replica proof found (the file at position 0 was
 * excluded from being "the input" whenever a flag that was NOT given
 * happened to compute a would-be position of 0) is unit-testable without
 * spawning the script: `i !== emitAt + 1` is `i !== 0` whenever `emitAt`
 * is -1 (not given), which excludes the candidates file itself when it is
 * the first argument — exactly the documented usage. Fixed by only
 * excluding a flag's value position when that flag was actually given.
 */
export type BackfillArgsPlan =
  | { ok: true; input: string; cutoff: Date; out: string | undefined }
  | { ok: false; error: string };

export function planBackfillArgs(args: readonly string[]): BackfillArgsPlan {
  const emitAt = args.indexOf("--emit-sql");
  const cutAt = args.indexOf("--cutoff");
  const out = emitAt >= 0 ? args[emitAt + 1] : undefined;
  const cutRaw = cutAt >= 0 ? args[cutAt + 1] : undefined;
  const cutoff = cutRaw !== undefined ? validCutoff(cutRaw) : null;
  const input = args.find((a, i) =>
    !a.startsWith("--") && (emitAt < 0 || i !== emitAt + 1) && (cutAt < 0 || i !== cutAt + 1));
  const outOk = !out || (!out.startsWith("--") && out !== input);
  if (!input || (emitAt >= 0 && !out) || !outOk || !cutoff || !Number.isFinite(cutoff.getTime())) {
    return {
      ok: false,
      error: "usage: backfill:phone-country <candidates-file> --cutoff <ISO: the deploy's READY + skew max age, e.g. 2026-10-01T12:00:00Z> [--emit-sql <out.sql>]",
    };
  }
  return { ok: true, input, cutoff, out };
}

/**
 * The one UPDATE. Every value in it was shape-checked by `parseCandidates`
 * (uuids and ten digits only), so nothing a row carries can break out of its
 * literal. ASCII, no backslash, no transaction control: `ci:sql
 * --allow-write` and `execute_sql` both take it as is.
 */
export function flagSql(rows: readonly CandidateRow[]): string {
  if (rows.length === 0) throw new Error("flagSql: nothing to flag");
  for (const [i, r] of rows.entries()) checked(r, `row ${i + 1}`);
  const values = rows.map((r) => `  ('${r.id}'::uuid, '${r.phone_key}')`).join(",\n");
  return [
    "-- Holds customer phone digits. Do not commit, paste or share. Delete after running.",
    "-- Consent chain PR-1: the 0054 phone-country backfill's WRITE half,",
    "-- emitted by `pnpm --filter @bis/db backfill:phone-country --emit-sql`.",
    `-- ${rows.length} contact(s). Flags a row only while still unflagged and its`,
    "-- phone_key is still the one read.",
    "update public.contacts",
    "set phone_country_unconfirmed = true",
    "where phone_country_unconfirmed = false",
    "  and (id, phone_key) in (values",
    values,
    "  )",
    "returning id;",
    "",
  ].join("\n");
}
