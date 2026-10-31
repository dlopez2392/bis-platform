import { describe, it, expect } from "vitest";
import { contactMatchArgs, contactSearchFilter } from "./contacts";
import { contactSearchPlan } from "./contact-search";
import { sanitizeSearchTerm } from "./search-term";

/**
 * F-092 scale follow-up (spec 4.4, plan T6): the arguments the app hands public.contacts_matching (0110). Pure.
 *
 * The call is a GET (or a HEAD for the count): postgrest-js puts every argument in the URL, drops an `undefined`,
 * writes an array as `{a,b}` UNQUOTED and writes `null` as the STRING "null" (@supabase/postgrest-js 2.110.8, rpc()).
 * So an absent part is OMITTED, never null; and the two array parts are sent as a PostgreSQL array literal the app
 * writes itself, every element double-quoted, because in an unquoted `{a,b}` the word null is a NULL element (found
 * by the live suite: the search "null" sent `{null}` and the matcher refused it, 22023, a failed search).
 */

/** Reads a part back as PostgreSQL's array input would, accepting only `{"w1","w2"}` with [a-z0-9]+ words. */
const QUOTED = /^\{"[a-z0-9]+"(,"[a-z0-9]+")*\}$/;
function words(literal: string | undefined): string[] {
  if (literal === undefined) return [];
  expect(literal).toMatch(QUOTED);
  return literal.slice(2, -2).split('","');
}

const TERMS: (string | undefined)[] = [
  undefined, "", " ", "%", "()", '"', "\\", ",", "*", "%%", "( )",
  "a", "_", "ma", "ana", "garcia", "María García", "GARCÍA-LÓPEZ", "garcía lópez", "o'brien", "李", "Иван",
  "john_doe", "maria5@example.com", "0199", "(956) 555-0199", "+52 1 899 123 4567", "044 899 123 4567",
  "+521 899 12", "+1 956", "+1 956 55", "1956", "a b c d e f g h", "x".repeat(200), "_".repeat(90), "null", "NULL",
  "{x}", "Taller Núñez",
];

describe("contactMatchArgs: null exactly when contactSearchFilter is null (spec 4.4)", () => {
  it.each(TERMS.map((t) => [t]))("%j", (term) => {
    expect(contactMatchArgs("acct-1", term) === null, String(term)).toBe(contactSearchFilter(term) === null);
  });
});

describe("contactMatchArgs: never a null, never an empty part, every array part a fully quoted literal", () => {
  it.each(TERMS.filter((t) => contactSearchFilter(t) !== null).map((t) => [t]))("%j", (term) => {
    const args = contactMatchArgs("acct-1", term)!;
    for (const [k, v] of Object.entries(args)) {
      expect(v, `${k} is never null or undefined (mutation: send p_national: null -> FAILS)`).not.toBeNull();
      expect(v, k).not.toBeUndefined();
      expect(typeof v, k).toBe("string");
      expect(v, k).not.toBe("");
      if (k === "p_tokens" || k === "p_phone_keys") {
        expect(v, `${k}: every element quoted, omitted when empty (mutation: send the bare array -> FAILS)`).toMatch(QUOTED);
      }
    }
    expect(Object.keys(args).filter((k) => !["p_account_id", "p_text", "p_tokens", "p_phone_keys", "p_national"].includes(k))).toEqual([]);
  });
});

describe("contactMatchArgs: the parts, from the same sanitizeSearchTerm and contactSearchPlan the oracle reads", () => {
  it('"María García": the account, the sanitized text, the folded words; no phone part at all', () => {
    expect(contactMatchArgs("acct-1", "María García")).toStrictEqual({
      p_account_id: "acct-1", p_text: "María García", p_tokens: '{"maria","garcia"}',
    });
  });

  it('"john_doe": the text keeps its escaped underscore (the matcher refuses a bare one); the word is the fold', () => {
    expect(contactMatchArgs("acct-1", "john_doe")).toStrictEqual({
      p_account_id: "acct-1", p_text: "john\\_doe", p_tokens: '{"johndoe"}',
    });
  });

  it('"(956) 555-0199": the new key only (today\'s digits are the same), no national (it IS the key)', () => {
    expect(contactMatchArgs("acct-1", "(956) 555-0199")).toStrictEqual({
      p_account_id: "acct-1", p_text: "956 555-0199", p_tokens: '{"956","555","0199"}', p_phone_keys: '{"9565550199"}',
    });
  });

  it('"+52 1 899 123 4567": the new key, then the kept key, then the national ten (mutation: drop the kept key -> FAILS)', () => {
    expect(contactMatchArgs("acct-1", "+52 1 899 123 4567")).toStrictEqual({
      p_account_id: "acct-1", p_text: "+52 1 899 123 4567", p_tokens: '{"52","1","899","123","4567"}',
      p_phone_keys: '{"528991234567","5218991234567"}', p_national: "8991234567",
    });
  });

  it('"+1 956": under the new floor, so only the kept key 1956', () => {
    expect(contactMatchArgs("acct-1", "+1 956")).toStrictEqual({
      p_account_id: "acct-1", p_text: "+1 956", p_tokens: '{"1","956"}', p_phone_keys: '{"1956"}',
    });
  });

  it('"李" folds to no word: the text alone (p_tokens omitted, the matcher\'s default is {})', () => {
    expect(contactMatchArgs("acct-1", "李")).toStrictEqual({ p_account_id: "acct-1", p_text: "李" });
  });

  it('"null" and "NULL" reach the matcher as the WORD null, {"null"}, never {null}, which PostgreSQL reads as a NULL element the matcher refuses (mutation: send the bare {null} -> FAILS)', () => {
    expect(contactMatchArgs("acct-1", "null")?.p_tokens).toBe('{"null"}');
    expect(contactMatchArgs("acct-1", "NULL")?.p_tokens).toBe('{"null"}');
    expect(contactMatchArgs("acct-1", "Null Reyes")?.p_tokens).toBe('{"null","reyes"}');
  });

  it("every part equals the oracle's own reading of the term, for every term", () => {
    for (const term of TERMS) {
      const args = contactMatchArgs("acct-1", term);
      if (!args) continue;
      const plan = contactSearchPlan(term!);
      expect(args.p_text, String(term)).toBe(sanitizeSearchTerm(term!));
      expect(words(args.p_tokens), String(term)).toEqual(plan.tokens);
      expect(words(args.p_phone_keys), String(term)).toEqual([plan.phone?.key, plan.keptKey].filter(Boolean));
      expect(args.p_national, String(term)).toBe(plan.phone?.national ?? undefined);
    }
  });

  it("the matcher's own input rules hold for every term: text at most 160, at most 6 words of 1-80, at most 2 keys of 1-20 digits, a national of 10", () => {
    for (const term of TERMS) {
      const args = contactMatchArgs("acct-1", term);
      if (!args) continue;
      expect(args.p_text.length, String(term)).toBeLessThanOrEqual(160);
      expect(args.p_text, String(term)).not.toContain("%");
      expect(words(args.p_tokens).length, String(term)).toBeLessThanOrEqual(6);
      for (const t of words(args.p_tokens)) expect(t.length, String(term)).toBeLessThanOrEqual(80);
      expect(words(args.p_phone_keys).length, String(term)).toBeLessThanOrEqual(2);
      for (const k of words(args.p_phone_keys)) expect(k, String(term)).toMatch(/^[0-9]{1,20}$/);
      if (args.p_national !== undefined) expect(args.p_national, String(term)).toMatch(/^[0-9]{10}$/);
    }
  });
});
