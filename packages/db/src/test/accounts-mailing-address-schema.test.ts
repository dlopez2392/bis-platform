import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { withRollback } from "./db";

/**
 * Migration 0048: `accounts.mailing_address` and its CHECK.
 *
 * The CHECK has a TypeScript twin it must agree with on every input: the app
 * side of the same rule is JavaScript's `.trim()` (the Branding action trims
 * before it saves; the reactivation pass reads a value that is blank after
 * `.trim()` as unset). 0033 shipped a whitespace rule that disagreed with its
 * twin on a tab, and nothing noticed until 0034. So this file proves the
 * agreement three ways:
 *
 *   1. STATICALLY: the character class written in the migration file, parsed
 *      and expanded, is EXACTLY the set of code points `.trim()` strips,
 *      enumerated here rather than remembered.
 *   2. LIVE vs FILE: the pattern stored in the live constraint is the pattern
 *      in the file. The first apply of 0048 stored a DOUBLED backslash (the
 *      class then held a literal `\` and a `0-\` range that stripped digits
 *      and capitals); it was replaced in a second apply. This pins that the
 *      repo file IS the live state, so (1) is a statement about production.
 *   3. BEHAVIOURALLY: every literal below is written to the live table inside
 *      a rolled-back transaction, and the database's verdict must be the one
 *      in the table, which must in turn be the one `.trim()` gives.
 *
 * Every Unicode character is built with `String.fromCodePoint`, never typed
 * as an escape sequence in this file: an editor tool on this machine turned
 * typed escapes into the raw invisible characters once already, and a raw
 * U+2028 in a string literal is unreadable in review.
 */

const ch = (cp: number) => String.fromCodePoint(cp);

/** Every code point JavaScript's `.trim()` removes, by exhaustive search. */
const JS_TRIM_SET: number[] = (() => {
  const out: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;   // lone surrogates are not characters
    if (String.fromCodePoint(cp).trim() === "") out.push(cp);
  }
  return out;
})();

/** The app-side rule the CHECK must equal: blank after `.trim()` is refused,
 *  and length is counted in CODE POINTS (`char_length`), not UTF-16 units. */
const jsVerdict = (value: string | null): "accepted" | "refused" => {
  if (value === null) return "accepted";
  const n = [...value.trim()].length;
  return n >= 1 && n <= 300 ? "accepted" : "refused";
};

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "..", "supabase", "migrations", "0048_accounts_mailing_address.sql"), "utf8");

/** The regexp_replace pattern as written in the migration file. */
const FILE_PATTERN = (() => {
  const m = MIGRATION.match(/'(\^\[[^']+)'/);
  if (!m) throw new Error("0048: no '^[...' pattern found in the migration file");
  return m[1]!;
})();

/** Expands a Postgres ARE bracket-expression body, restricted to the escapes
 *  the migration uses. A raw non-ASCII character is REFUSED rather than
 *  expanded: it would behave the same, but nobody can review it. */
function expandClass(cls: string): number[] {
  const ESC: Record<string, number> = { t: 0x09, n: 0x0a, r: 0x0d, f: 0x0c, v: 0x0b };
  const out: number[] = [];
  let i = 0;
  const atom = (): number => {
    const c = cls[i]!;
    if (c === "\\") {
      const e = cls[i + 1]!;
      if (e === "u") {
        const hex = cls.slice(i + 2, i + 6);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new Error(`bad escape at ${i}: ${cls.slice(i, i + 6)}`);
        i += 6;
        return parseInt(hex, 16);
      }
      if (e in ESC) { i += 2; return ESC[e]!; }
      throw new Error(`unexpected escape at ${i}: backslash ${e}`);
    }
    const cp = c.codePointAt(0)!;
    if (cp < 0x20 || cp > 0x7e) {
      throw new Error(`raw character U+${cp.toString(16).toUpperCase().padStart(4, "0")} at ${i}: write it as an escape`);
    }
    i += 1;
    return cp;
  };
  while (i < cls.length) {
    const lo = atom();
    if (cls[i] === "-" && i + 1 < cls.length) {
      i += 1;
      const hi = atom();
      for (let cp = lo; cp <= hi; cp++) out.push(cp);
    } else {
      out.push(lo);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** `^[CLASS]+|[CLASS]+$` → the two class bodies. */
function classesOf(pattern: string): [string, string] {
  const m = pattern.match(/^\^\[(.+)\]\+\|\[(.+)\]\+\$$/);
  if (!m) throw new Error(`pattern is not ^[...]+|[...]+$: ${pattern}`);
  return [m[1]!, m[2]!];
}

describe("0048 accounts.mailing_address — the column", () => {
  it("is nullable text with no default: unset is the state every account starts in", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts' and column_name = 'mailing_address'`,
      );
      expect(rows).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
    });
  });
});

describe("0048 accounts_mailing_address_check — the whitespace class is .trim()'s", () => {
  it("enumerates .trim()'s set as 25 code points (the count the migration header states)", () => {
    expect(JS_TRIM_SET).toHaveLength(25);
  });

  it("writes both halves of the migration's pattern with the SAME class", () => {
    const [lead, trail] = classesOf(FILE_PATTERN);
    expect(trail).toBe(lead);
  });

  it("expands the migration's class to EXACTLY the code points .trim() strips", () => {
    const [lead] = classesOf(FILE_PATTERN);
    const hex = (cps: number[]) => cps.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    expect(hex(expandClass(lead))).toEqual(hex(JS_TRIM_SET));
  });

  it("stores the file's pattern in the LIVE constraint, byte for byte", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'public.accounts'::regclass
            and conname = 'accounts_mailing_address_check'`,
      );
      expect(rows).toHaveLength(1);
      // `between 1 and 300` deparses to two calls, so the pattern appears
      // twice; both must be the file's.
      const live = [...rows[0]!.def.matchAll(/'(\^\[[^']*)'::text/g)].map((m) => m[1]);
      expect(live.length).toBeGreaterThanOrEqual(1);
      for (const p of live) expect(p).toBe(FILE_PATTERN);
    });
  });
});

type Verdict = "accepted" | "refused";

/** The literal shapes this column will actually meet: a typed address, the
 *  padding a CSV or a paste carries, every class of blank, and the edges of
 *  the length bound. */
const CASES: [label: string, value: string | null, verdict: Verdict][] = [
  ["NULL (not set)", null, "accepted"],
  ["a two-line address", "123 Main St\nMcAllen, TX 78501", "accepted"],
  ["CSV padding: spaces in front, tab and newline behind", "  123 Main St\nMcAllen, TX 78501\t\n", "accepted"],
  ["a CRLF between the lines", "123 Main St\r\nMcAllen, TX 78501", "accepted"],
  // The two that would have caught the first, bad apply: its class carried a
  // `0-\` range, which strips every digit and capital from both ends.
  ["digits at both ends: '12345'", "12345", "accepted"],
  ["capitals at both ends: 'PO BOX A'", "PO BOX A", "accepted"],
  ["one character", "x", "accepted"],
  ["a zero-width space alone (NOT whitespace to .trim())", ch(0x200b), "accepted"],
  ["exactly 300 characters", "a".repeat(300), "accepted"],
  ["300 characters padded with no-break spaces", ch(0xa0) + "a".repeat(300) + ch(0xa0), "accepted"],
  ["150 house emoji: 150 code points, 300 UTF-16 units", ch(0x1f3e0).repeat(150), "accepted"],
  ["the empty string", "", "refused"],
  ["spaces only", "   ", "refused"],
  ["a tab alone", "\t", "refused"],
  ["a bare CRLF", "\r\n", "refused"],
  ["vertical tab and form feed", "\v\f", "refused"],
  ["a no-break space alone", ch(0xa0), "refused"],
  ["a byte-order mark alone", ch(0xfeff), "refused"],
  ["an ideographic space alone", ch(0x3000), "refused"],
  ["line and paragraph separators", ch(0x2028) + ch(0x2029), "refused"],
  ["all 25 of .trim()'s characters together", JS_TRIM_SET.map(ch).join(""), "refused"],
  ["301 characters", "a".repeat(301), "refused"],
];

type Outcome = { stored: string | null } | { code: string | undefined; constraint: string | undefined };

/** Writes `value` on a brand-new accounts row inside a transaction that is
 *  always rolled back, so nothing outlives the call. One statement per
 *  `withRollback`: a refusal aborts the transaction (25P02). */
async function tryStore(value: string | null): Promise<Outcome> {
  let outcome: Outcome | undefined;
  await withRollback(async (c) => {
    try {
      const { rows } = await c.query<{ mailing_address: string | null }>(
        `insert into public.accounts (agency_id, clerk_org_id, name, mailing_address)
         select id, $1, 'Fixture Co', $2 from public.agencies limit 1
         returning mailing_address`,
        [`org_test_${Math.random().toString(36).slice(2, 10)}`, value],
      );
      if (rows.length !== 1) throw new Error("no agencies row to hang the throwaway account on");
      outcome = { stored: rows[0]!.mailing_address };
    } catch (e) {
      const err = e as { code?: string; constraint?: string; message?: string };
      if (!err.code) throw e;
      outcome = { code: err.code, constraint: err.constraint };
    }
  });
  return outcome!;
}

describe("0048 accounts_mailing_address_check — the live verdicts", () => {
  // Guards the table itself: a case whose expected verdict disagrees with
  // `.trim()` would make the live test below prove the wrong thing.
  it("expects, for every case, exactly the verdict .trim() gives", () => {
    expect(CASES.map(([label, value]) => [label, jsVerdict(value)]))
      .toEqual(CASES.map(([label, , verdict]) => [label, verdict]));
  });

  it.each(CASES)("%s", async (_label, value, verdict) => {
    const outcome = await tryStore(value);
    if (verdict === "accepted") {
      // Stored VERBATIM: the CHECK judges and never normalises, so there is
      // no stored key for the two sides to disagree on.
      expect(outcome).toEqual({ stored: value });
    } else {
      // By code AND name: 23514 from some other CHECK would not be this one.
      expect(outcome).toEqual({ code: "23514", constraint: "accounts_mailing_address_check" });
    }
  });
});
