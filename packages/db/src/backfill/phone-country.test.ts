import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sqlRefusals } from "../ci/sql";
import { byWriter, countByAccount, flagSql, parseCandidates, planBackfillArgs, rowsToFlag, type CandidateRow } from "./phone-country";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const row = (n: number, phone: string, phone_key: string, account = A, last_written_at = "2026-10-01T12:00:00.000Z", created_at = "2026-09-01T12:00:00.000Z"): CandidateRow =>
  ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, account_id: account, phone, phone_key, last_written_at, created_at });

describe("parseCandidates", () => {
  it("reads execute_sql's JSON array", () => {
    const r = row(1, "+15512345678", "5512345678");
    expect(parseCandidates(JSON.stringify([r]))).toEqual([r]);
  });

  it("reads ci:sql's tab-separated text with its header", () => {
    const r = row(2, "55 1234 5678", "5512345678");
    expect(parseCandidates(`id\taccount_id\tphone\tphone_key\tlast_written_at\tcreated_at\n${r.id}\t${r.account_id}\t${r.phone}\t${r.phone_key}\t${r.last_written_at}\t${r.created_at}\n`)).toEqual([r]);
  });

  it("THROWS on a malformed row rather than half-reading it (mutation: skip bad rows → FAILS)", () => {
    expect(() => parseCandidates(JSON.stringify([{ ...row(3, "+15512345678", "5512345678"), id: "x'); drop table contacts; --" }])))
      .toThrow("row 1: id is not a uuid");
    expect(() => parseCandidates(JSON.stringify([row(4, "+15512345678", "55123")]))).toThrow("phone_key is not ten digits");
    expect(() => parseCandidates("id\tphone\n1\t2")).toThrow("header");
  });

  it("empty input is no rows", () => {
    expect(parseCandidates("  \n")).toEqual([]);
  });
});

describe("rowsToFlag", () => {
  it("keeps exactly the numbers that could be Mexican (mutation: keep every candidate → FAILS)", () => {
    const rows = [
      row(1, "+15512345678", "5512345678"),   // +1, valid under +52: flag
      row(2, "+19562921696", "9562921696"),   // McAllen: no
      row(3, "55 1234 5678", "5512345678"),   // bare, both: flag
      row(4, "899 922 1234", "8999221234"),   // bare Reynosa: the gate reads +52 already
    ];
    expect(rowsToFlag(rows).map((r) => r.phone)).toEqual(["+15512345678", "55 1234 5678"]);
  });
});

describe("countByAccount", () => {
  it("counts per account", () => {
    expect([...countByAccount([row(1, "x", "5512345678"), row(2, "x", "5512345678", B), row(3, "x", "5512345678")])])
      .toEqual([[A, 2], [B, 1]]);
  });
});

describe("flagSql", () => {
  const sql = flagSql([row(1, "+15512345678", "5512345678"), row(2, "55 1234 5678", "5512345678")]);

  it("guards on BOTH still-unflagged and the phone_key that was read (mutation: drop the phone_key pairing → FAILS)", () => {
    expect(sql).toContain("where phone_country_unconfirmed = false");
    expect(sql).toContain("and (id, phone_key) in (values");
    expect(sql).toContain(`('${row(1, "", "").id}'::uuid, '5512345678')`);
    expect(sql).toContain("returning id;");
  });

  it("never carries the phone AS TYPED OR DIALED — only the id and the bare phone_key digits, which the file's own warning below exists because of (review I6: phone_key IS the customer's number, just reformatted)", () => {
    expect(sql).not.toContain("+15512345678");
    expect(sql).not.toContain("55 1234 5678");
  });

  it("starts with a warning that the file holds real customer phone digits and should not be committed, pasted or shared (review I6; mutation: drop the warning line → FAILS)", () => {
    expect(sql.startsWith("-- Holds customer phone digits. Do not commit, paste or share. Delete after running.\n")).toBe(true);
  });

  it("is ASCII, backslash-free, and passes ci:sql's WRITE gate (no transaction control)", () => {
    expect([...sql].every((ch) => ch.charCodeAt(0) <= 0x7e)).toBe(true);
    expect(sql.includes(String.fromCharCode(0x5c))).toBe(false);
    expect(sqlRefusals(sql, { allowWrite: true })).toEqual([]);
    expect(sqlRefusals(sql, { allowWrite: false }).length).toBeGreaterThan(0);
  });

  it("refuses to emit an empty update", () => {
    expect(() => flagSql([])).toThrow("nothing to flag");
  });

  it("re-checks every row itself, even one that bypassed parseCandidates (review m1; mutation: drop flagSql's own checked() loop → FAILS)", () => {
    const malformed = { id: "not-a-uuid", account_id: A, phone: "+15512345678", phone_key: "5512345678", last_written_at: "2026-10-01T12:00:00.000Z", created_at: "2026-09-01T12:00:00.000Z" } as CandidateRow;
    expect(() => flagSql([malformed])).toThrow("id is not a uuid");
  });
});

describe("the read file", () => {
  const text = readFileSync(fileURLToPath(new URL("../../supabase/backfills/0054-phone-country-candidates.sql", import.meta.url)), "utf8");
  it("selects exactly the six columns the parser reads, in order (mutation: drop created_at → FAILS)", () => {
    expect(text).toMatch(/select c\.id, c\.account_id, c\.phone, c\.phone_key,\s+to_char\(c\.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\) as last_written_at,\s+to_char\(c\.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\) as created_at\s/);
  });
  it("pins the presence of the calls- and messages-exclusion clauses' key tokens (review m6: a string check, not a behavior proof — the DB-level test in phone-country-backfill.test.ts proves the actual NOT EXISTS behavior)", () => {
    expect(text).toContain("c.phone_country_unconfirmed = false");
    expect(text).toContain("from public.calls k");
    expect(text).toContain("m.direction = 'inbound'");
  });
});

describe("byWriter: who wrote the number, from what can be known (review R1-I1, re-review B)", () => {
  const CUT = new Date("2026-10-01T12:00:00.000Z");

  it("created before the cut-off is flagged even when renamed after it, and reported as written after (mutation: decide by last_written_at → the renamed old +1 is dropped, FAILS)", () => {
    const renamed = row(1, "+15512345678", "5512345678", A, "2026-10-02T09:00:00.000Z", "2026-09-01T12:00:00.000Z");
    const untouched = row(2, "+15512345679", "5512345679", A, "2026-09-02T12:00:00.000Z", "2026-09-01T12:00:00.000Z");
    const r = byWriter([renamed, untouched], CUT);
    expect(r.flag).toEqual([renamed, untouched]);
    expect(r.writtenAfter).toEqual([renamed]);
    expect(r.newBuild).toEqual([]);
  });

  it("created AT or after the cut-off and stored as E.164 is the new build's: not flagged, reported (mutation: flag every row → FAILS; created_at <= → the row created AT the cut-off is flagged, FAILS)", () => {
    const at = row(1, "+15512345678", "5512345678", A, "2026-10-01T12:00:00.000Z", "2026-10-01T12:00:00.000Z");
    const later = row(2, "+15512345679", "5512345679", A, "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
    const r = byWriter([at, later], CUT);
    expect(r.flag).toEqual([]);
    expect(r.newBuild).toEqual([at, later]);
  });

  it("a number NOT stored as E.164 is the old build's whenever it was created: flagged (mutation: decide by created_at alone → FAILS)", () => {
    const bare = row(1, "55 1234 5678", "5512345678", A, "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
    expect(byWriter([bare], CUT).flag).toEqual([bare]);
  });

  it("a row without a readable last write or creation is refused at parse time, never guessed (mutation: drop either ISO check → FAILS)", () => {
    expect(() => parseCandidates(JSON.stringify([{ ...row(1, "+15512345678", "5512345678"), last_written_at: "2026-10-01 12:00:00+00" }])))
      .toThrow("last_written_at is not a UTC ISO instant");
    expect(() => parseCandidates(JSON.stringify([{ ...row(1, "+15512345678", "5512345678"), created_at: "2026-10-01 12:00:00+00" }])))
      .toThrow("created_at is not a UTC ISO instant");
  });

  it("an unreadable cut-off throws rather than flagging or keeping everything (mutation: drop the date check → every row lands in newBuild, FAILS)", () => {
    expect(() => byWriter([row(1, "+15512345678", "5512345678")], new Date("not a date"))).toThrow("the cut-off is not a date");
  });

  it("last_written_at EXACTLY at the cut-off counts as written after (review m2, the >= boundary; mutation: '>' instead of '>=' → FAILS)", () => {
    const atCutoff = row(1, "+15512345678", "5512345678", A, "2026-10-01T12:00:00.000Z", "2026-09-01T12:00:00.000Z");
    expect(byWriter([atCutoff], CUT).writtenAfter).toEqual([atCutoff]);
  });

  it("a spaced '+1 551 234 5678' created AFTER the cut-off is still flagged: it is not stored in the E.164 shape the new build writes (review m3; mutation: loosen the E164 regex to allow spaces → FAILS)", () => {
    const spaced = row(1, "+1 551 234 5678", "5512345678", A, "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
    const r = byWriter([spaced], CUT);
    expect(r.flag).toEqual([spaced]);
    expect(r.newBuild).toEqual([]);
  });
});

describe("injection guard: the id and phone_key regex anchors (review I2)", () => {
  it("refuses an id that is a valid uuid followed by a payload and a trailing newline, in BOTH parseCandidates and flagSql's own re-check (mutation: unanchor the UUID regex → FAILS)", () => {
    const bad = { ...row(1, "+15512345678", "5512345678"), id: "11111111-1111-4111-8111-111111111111'); update contacts set phone_country_unconfirmed=false; --\n" };
    expect(() => parseCandidates(JSON.stringify([bad]))).toThrow("id is not a uuid");
    expect(() => flagSql([bad])).toThrow("id is not a uuid");
  });

  it("refuses a phone_key that is a valid ten-digit key followed by a payload and a trailing newline, in BOTH parseCandidates and flagSql's own re-check (mutation: unanchor the KEY regex → FAILS)", () => {
    const bad = { ...row(1, "+15512345678", "5512345678"), phone_key: "5512345678') or (1=1) --\n" };
    expect(() => parseCandidates(JSON.stringify([bad]))).toThrow("phone_key is not ten digits");
    expect(() => flagSql([bad])).toThrow("phone_key is not ten digits");
  });
});

describe("planBackfillArgs: the CLI's own usage line, `<candidates-file> --cutoff <ISO> [--emit-sql <out.sql>]` (found live via the required replica proof, not in the brief)", () => {
  it("reads the candidates file given FIRST when --emit-sql is omitted (mutation: index the missing flag's position as 0 → the file at position 0 is wrongly excluded, FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00.000Z"]);
    expect(plan).toEqual({ ok: true, input: "candidates.tsv", cutoff: new Date("2026-10-01T12:00:00.000Z"), out: undefined });
  });

  it("still refuses without --cutoff even when --emit-sql is given (review m5: retitled — this asserts a refusal, not a read; the file-position exclusion bug I2 fixed is symmetric here too, but --cutoff stays required regardless)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--emit-sql", "out.sql"]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toContain("usage");
  });

  it("carries --emit-sql's target when given", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00.000Z", "--emit-sql", "out.sql"]);
    expect(plan).toEqual({ ok: true, input: "candidates.tsv", cutoff: new Date("2026-10-01T12:00:00.000Z"), out: "out.sql" });
  });

  it("refuses without --cutoff (mutation: make --cutoff optional → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses an unreadable --cutoff", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "not a date"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses --emit-sql with no file name after it", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00.000Z", "--emit-sql"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses with no candidates file at all", () => {
    const plan = planBackfillArgs(["--cutoff", "2026-10-01T12:00:00.000Z"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses a year-only --cutoff, '2026' (review I3: silently means before 2026-01-01Z; mutation: accept anything new Date parses → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses a single-digit --cutoff, '1' (review I3: silently means before 2001; mutation: accept anything new Date parses → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "1"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses a zone-less --cutoff, '2026-10-01T12:00:00' (review I3: read as the RUNNING MACHINE's local zone, not UTC; mutation: accept anything new Date parses → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses a date-only --cutoff, '2026-10-01' (review I3; mutation: accept anything new Date parses → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01"]);
    expect(plan.ok).toBe(false);
  });

  it("accepts a UTC ISO --cutoff WITHOUT milliseconds (review I3: the parser's own ISO shape makes milliseconds optional too)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00Z"]);
    expect(plan).toEqual({ ok: true, input: "candidates.tsv", cutoff: new Date("2026-10-01T12:00:00Z"), out: undefined });
  });

  it("refuses --emit-sql when its value starts with '--' (review m4: a missing value would otherwise silently consume the NEXT flag; mutation: drop this check → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00.000Z", "--emit-sql", "--cutoff"]);
    expect(plan.ok).toBe(false);
  });

  it("refuses --emit-sql when its value equals the input file (review m4: would read then overwrite the candidates file; mutation: drop this check → FAILS)", () => {
    const plan = planBackfillArgs(["candidates.tsv", "--cutoff", "2026-10-01T12:00:00.000Z", "--emit-sql", "candidates.tsv"]);
    expect(plan.ok).toBe(false);
  });
});

describe("parseCandidates never echoes the input into an error message (review I7)", () => {
  const DIGIT_RUN = /\d{7,}/;

  it("a JSON OBJECT (not an array) refuses without printing the object's own fields (mutation: include the raw text in the message → FAILS)", () => {
    let message = "";
    try {
      parseCandidates(JSON.stringify({ phone: "+15512345678", secret_field: "5551234567" }));
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toBe("");
    expect(message).not.toMatch(DIGIT_RUN);
  });

  it("a trailing comma in a JSON array refuses with a fixed message, not V8's own snippet of the input (mutation: let JSON.parse's own SyntaxError escape → FAILS)", () => {
    let message = "";
    try {
      parseCandidates('[{"id":"11111111-1111-4111-8111-111111111111","phone":"+15512345678"},]');
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toBe("");
    expect(message).not.toMatch(DIGIT_RUN);
  });

  it("a TSV with no header row refuses without printing the data row (mutation: include names.join(',') raw → FAILS)", () => {
    let message = "";
    try {
      parseCandidates("some-id\tacct-1\t+15512345678\t5512345678\t2026-01-01T00:00:00.000Z\t2026-01-01T00:00:00.000Z");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toBe("");
    expect(message).not.toMatch(DIGIT_RUN);
  });
});
