import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactSearchFilter, listContacts, countContacts, phoneDigits } from "./contacts";
import { sanitizeSearchTerm } from "./search-term";
import { contactSearchName, phoneNational } from "./dedupe-keys";

/**
 * F-092 part 1 (plan Task 4, spec 4.4): the ONE filter the contact list, its real total and the export apply.
 * Pure: no Supabase variable in this shell. The live proof (PostgREST accepts it, rows equal the count) is
 * src/test/contact-search-live.test.ts.
 */

const RAW = (s: string) => [`first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, `email.ilike.%${s}%`, `phone.ilike.%${s}%`];

describe("contactSearchFilter: the exact .or() argument", () => {
  it('"María García" keeps the four raw arms and ADDS every folded word on search_name (mutation: drop the and(...) arm -> FAILS)', () => {
    expect(contactSearchFilter("María García")).toBe(
      [...RAW("María García"), "and(search_name.ilike.%maria%,search_name.ilike.%garcia%)"].join(","),
    );
  });

  it('"garcia" is one word: a bare search_name arm, no and()', () => {
    expect(contactSearchFilter("garcia")).toBe([...RAW("garcia"), "search_name.ilike.%garcia%"].join(","));
  });

  it('"(956) 555-0199" adds its words and the phone_key digits', () => {
    expect(contactSearchFilter("(956) 555-0199")).toBe([
      ...RAW("956 555-0199"),
      "and(search_name.ilike.%956%,search_name.ilike.%555%,search_name.ilike.%0199%)",
      "phone_key.ilike.%9565550199%",
    ].join(","));
  });

  it('"+52 1 899 123 4567" adds the +52 key, today\'s digits (not covered by the new key) and the national ten (mutation: drop the national arm -> FAILS)', () => {
    expect(contactSearchFilter("+52 1 899 123 4567")).toBe([
      ...RAW("+52 1 899 123 4567"),
      "and(search_name.ilike.%52%,search_name.ilike.%1%,search_name.ilike.%899%,search_name.ilike.%123%,search_name.ilike.%4567%)",
      "phone_key.ilike.%528991234567%",
      "phone_key.ilike.%5218991234567%",
      "phone_national.ilike.%8991234567%",
    ].join(","));
  });

  it('"+1 956 55" carries only the new, wider key: today\'s "195655" contains "95655", so today\'s clause is covered and not repeated', () => {
    expect(contactSearchFilter("+1 956 55")).toBe([
      ...RAW("+1 956 55"),
      "and(search_name.ilike.%1%,search_name.ilike.%956%,search_name.ilike.%55%)",
      "phone_key.ilike.%95655%",
    ].join(","));
  });

  it('"+1 956" is under the new floor but today searched phone_key for 1956: that clause is KEPT, so nobody found today is lost (mutation: drop the kept clause -> FAILS)', () => {
    expect(contactSearchFilter("+1 956")).toBe([
      ...RAW("+1 956"),
      "and(search_name.ilike.%1%,search_name.ilike.%956%)",
      "phone_key.ilike.%1956%",
    ].join(","));
  });

  it('"john_doe" keeps today\'s escaped underscore on the raw arms; its word is the fold, johndoe', () => {
    expect(contactSearchFilter("john_doe")).toBe([...RAW("john\\_doe"), "search_name.ilike.%johndoe%"].join(","));
  });

  it('"李" folds to no word: only the raw arms, which still find it', () => {
    expect(contactSearchFilter("李")).toBe(RAW("李").join(","));
  });

  it.each([["%"], ["()"], [""], [undefined]] as const)("%j means no filter at all (the list then shows everything)", (term) => {
    expect(contactSearchFilter(term)).toBeNull();
  });
});

/**
 * The superset (spec D4, Global Constraints): af5976fa's withSearch, frozen here as the oracle. Two checks.
 * 1. By construction: the first four clauses are exactly today's, and today's phone_key clause is either present
 *    verbatim or covered by a phone_key clause whose digits it contains.
 * 2. By evaluation: every clause is run, as Postgres ILIKE would run it, over rows whose generated keys are built
 *    by their TypeScript twins (phone_key = phoneDigits, 0033; phone_national = phoneNational, 0106; search_name =
 *    contactSearchName, 0108), and every row today's filter matches, the new one matches too.
 */
const TODAY_PHONE_SHAPE = /^[+()\-. \d]+$/;
function todayFilter(search: string | undefined): string | null {
  const s = search ? sanitizeSearchTerm(search) : undefined;
  if (!s) return null;
  const clauses = RAW(s);
  let digits = "";
  if (search && TODAY_PHONE_SHAPE.test(search)) {
    const d = phoneDigits(search);
    digits = d.length >= 4 ? d.slice(0, 20) : "";
  }
  if (digits) clauses.push(`phone_key.ilike.%${digits}%`);
  return clauses.join(",");
}

/** Splits a PostgREST logic list on its top-level commas (an and(...) group stays whole). */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

type Row = Record<string, string | null>;
function row(first: string | null, last: string | null, email: string | null, phone: string | null, company: string | null = null): Row {
  return {
    first_name: first, last_name: last, email, phone,
    phone_key: phone === null ? null : phoneDigits(phone),
    phone_national: phoneNational(phone),
    search_name: contactSearchName(first, last, company),
  };
}

/** ILIKE '%x%' as these clauses use it: case-insensitive substring; `\_` is a literal underscore (search-term.ts). */
function clauseMatches(clause: string, r: Row): boolean {
  if (clause.startsWith("and(")) return topLevel(clause.slice(4, -1)).every((c) => clauseMatches(c, r));
  const m = /^([a-z_]+)\.ilike\.%(.*)%$/s.exec(clause);
  if (!m) throw new Error(`unexpected clause ${clause}`);
  const value = r[m[1]!];
  if (value === null || value === undefined) return false;
  return value.toLowerCase().includes(m[2]!.replace(/\\_/g, "_").toLowerCase());
}
const filterMatches = (filter: string | null, r: Row) => filter === null || topLevel(filter).some((c) => clauseMatches(c, r));

const TERMS = [
  "María García", "garcia", "GARCÍA", "maria lopez", "(956) 555-0199", "+1 956 555 0199", "+1 956 55", "+1 956",
  "+521 899 12", "+52 1 899 123 4567", "044 899 123 4567", "0199", "john_doe", "maria5@example.com", "Suite 9",
  "李", "O'Brien", 'trevi"', "trev%", "1-800", "19565550199", "1956",
];
const ROWS: Row[] = [
  row("María", "García López", null, "+528991234567"),
  row("Maria", "Garcia", "maria@shop.com", "+19565550199"),
  row("Legacy", "Mobile", null, "+5218991234567"),       // a +521 number stored before F-009 dropped the 1
  row("Coincidence", null, null, "+19562195612"),        // its key holds 1956
  row("Rosa", "Trevino", "rosa@shop.com", null),
  row("john_doe", null, null, null),
  row("johnXdoe", null, null, null),
  row("李", "王", null, null),
  row("José", "O'Brien", null, "+18005551234"),
  row("Maria5", null, "maria5@example.com", null),
  row("Juan", "Pérez", null, null, "Taller Núñez"),
];

describe("contactSearchFilter is a superset of today's filter", () => {
  it.each(TERMS.map((t) => [t]))("%j: today's four raw clauses come first, unchanged, and today's phone_key clause is kept or covered (mutation: replace the raw arms with the word arm -> FAILS)", (term) => {
    const today = topLevel(todayFilter(term)!);
    const now = topLevel(contactSearchFilter(term)!);
    expect(now.slice(0, 4)).toEqual(today.slice(0, 4));
    const todayPhone = today[4];
    if (todayPhone !== undefined) {
      const digits = /^phone_key\.ilike\.%(\d+)%$/.exec(todayPhone)![1]!;
      const covered = now.some((c) => {
        const k = /^phone_key\.ilike\.%(\d+)%$/.exec(c)?.[1];
        return k !== undefined && digits.includes(k);
      });
      expect(covered, `today's ${todayPhone} is neither kept nor covered`).toBe(true);
    }
  });

  it("by evaluation over rows built with the generated keys' twins: every row today's filter finds, the new filter finds (mutation: emit only the plan's new key, without today's clause -> FAILS on +1 956 and +521 899 12)", () => {
    const lost: string[] = [];
    for (const term of TERMS) {
      const today = todayFilter(term);
      const now = contactSearchFilter(term);
      for (const r of ROWS) {
        if (filterMatches(today, r) && !filterMatches(now, r)) lost.push(`${term} -> ${r.first_name} ${r.phone ?? ""}`);
      }
    }
    expect(lost).toEqual([]);
  });

  it("and it finds what today's could not (the point of F-092): accents, full names, +52 shapes, the business name", () => {
    const finds = (term: string, first: string) => filterMatches(contactSearchFilter(term), ROWS.find((r) => r.first_name === first)!);
    const today = (term: string, first: string) => filterMatches(todayFilter(term), ROWS.find((r) => r.first_name === first)!);
    for (const [term, first] of [["garcia", "María"], ["maria lopez", "María"], ["garcia maria", "Maria"],
      ["+52 1 899 123 4567", "María"], ["044 899 123 4567", "María"], ["+521 899 12", "María"], ["+1 956 55", "Maria"],
      ["nunez", "Juan"]] as const) {
      expect(today(term, first), `${term} already found ${first} today`).toBe(false);
      expect(finds(term, first), `${term} finds ${first}`).toBe(true);
    }
  });
});

/** A fake client that records every call; awaiting it answers an empty page with a zero count. */
function recordingDb() {
  const calls: [string, unknown[]][] = [];
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy; };
    },
  });
  return { db: proxy as SupabaseClient, calls };
}

describe("listContacts and countContacts hand the SAME filter to .or()", () => {
  it('with "María García" each records exactly one or(), with contactSearchFilter\'s string (mutation: countContacts skips withSearch -> FAILS)', async () => {
    const list = recordingDb();
    const count = recordingDb();
    await listContacts(list.db, "acct", { search: "María García" });
    await countContacts(count.db, "acct", { search: "María García" });
    const expected = contactSearchFilter("María García");
    expect(expected).not.toBeNull();
    expect(list.calls.filter(([m]) => m === "or")).toEqual([["or", [expected]]]);
    expect(count.calls.filter(([m]) => m === "or")).toEqual([["or", [expected]]]);
  });

  it('with "%" neither records an or()', async () => {
    const list = recordingDb();
    const count = recordingDb();
    await listContacts(list.db, "acct", { search: "%" });
    await countContacts(count.db, "acct", { search: "%" });
    expect(list.calls.some(([m]) => m === "or")).toBe(false);
    expect(count.calls.some(([m]) => m === "or")).toBe(false);
    expect(list.calls.some(([m]) => m === "from")).toBe(true);
  });
});
