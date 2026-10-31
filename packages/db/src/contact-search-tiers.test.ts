import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchContacts, contactMatchArgs } from "./contacts";

/**
 * F-092 part 1 (plan Task 5, spec 5, owner ruling Q3): the small boxes (⌘K, the relationship picker, Add job, held
 * email) rank the best match first in three tiers: exact, every word starts a word, contains. Pure: no Supabase
 * variable in this shell; the live proof that PostgREST takes these strings is the last describe of
 * src/test/contact-search-live.test.ts.
 *
 * F-092 scale follow-up (spec 4.4, plan T6): every tier's source is public.contacts_matching (0110), called as a GET
 * with contactMatchArgs, in place of from("contacts") plus the list's .or(filter); tier 1's and tier 2's own or()
 * narrow it exactly as they narrowed the filter, so each tier is still a subset of the list's match set.
 */

type Call = [method: string, args: unknown[]];
type Query = { calls: Call[] };
type Answer = { data: { id: string }[] | null; error: { message: string } | null };

/** A fake client: every from() or rpc() starts its own recorded query; awaiting one answers whatever `answer` says. */
function tieredDb(answer: (q: Query) => Answer = () => ({ data: [], error: null })) {
  const queries: Query[] = [];
  const start = (method: string) => (...args: unknown[]) => {
      const q: Query = { calls: [[method, args]] };
      queries.push(q);
      const builder: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              Promise.resolve().then(() => answer(q)).then(resolve, reject);
          }
          return (...a: unknown[]) => { q.calls.push([String(prop), a]); return builder; };
        },
      });
      return builder;
  };
  const db = { from: start("from"), rpc: start("rpc") };
  return { db: db as unknown as SupabaseClient, queries };
}

const ors = (q: Query) => q.calls.filter(([m]) => m === "or").map(([, a]) => a[0]);

/** Which tier a query is, read from what it asked for beyond the matcher's match set. */
function tierOf(q: Query): 1 | 2 | 3 {
  const extra = ors(q);
  if (extra.length === 0) return 3;
  return String(extra[0]).includes(".eq.") ? 1 : 2;
}

describe("searchContacts: the three tiers' queries", () => {
  it('"ana": exact on search_name, then every word starts a word, then contains; each on top of the matcher\'s match set, called as a GET with the list\'s own arguments (mutations: a tier left on from("contacts") -> FAILS; the rpc without get: true -> FAILS)', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "ana", limit: 5 });
    const args = contactMatchArgs("acct", "ana");
    expect(args).not.toBeNull();
    expect(queries.map((q) => q.calls[0])).toEqual(Array(3).fill(["rpc", ["contacts_matching", args, { get: true }]]));
    expect(queries.map(ors)).toEqual([
      ["search_name.eq.ana"],
      ["search_name.ilike.ana%,search_name.ilike.% ana%"],
      [],
    ]);
  });

  it('two words: tier 2 asks for EACH word to start a word (one or() per word, so they AND)', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "García Ana", limit: 5 });
    expect(ors(queries[0]!)).toEqual(["search_name.eq.garcia ana"]);
    expect(ors(queries[1]!)).toEqual([
      "search_name.ilike.garcia%,search_name.ilike.% garcia%",
      "search_name.ilike.ana%,search_name.ilike.% ana%",
    ]);
  });

  it('"maria5@example.com": tier 1 is the folded name or the email key, quoted', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "maria5@example.com", limit: 5 });
    expect(ors(queries[0]!)).toEqual(['search_name.eq.maria5example com,email_key.eq."maria5@example.com"']);
  });

  it('"(956) 555-0199": tier 1 also asks for the national ten exactly', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "(956) 555-0199", limit: 5 });
    expect(ors(queries[0]!)).toEqual(["search_name.eq.956 555 0199,phone_national.eq.9565550199"]);
  });

  it('"+52 1 899 123 4567": the national ten of a legacy +52 shape is the exact phone', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "+52 1 899 123 4567", limit: 5 });
    expect(ors(queries[0]!)).toHaveLength(1);
    expect(String(ors(queries[0]!)[0])).toMatch(/,phone_national\.eq\.8991234567$/);
  });

  it('"0199" is too short to be a whole number: tier 1 has no phone_national arm', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "0199", limit: 5 });
    expect(ors(queries[0]!)).toEqual(["search_name.eq.0199"]);
  });

  it('"李" folds to no word, has no phone and no @: only tier 3 runs (the raw arms still find it)', async () => {
    const { db, queries } = tieredDb();
    await searchContacts(db, "acct", { term: "李", limit: 5 });
    expect(queries.map((q) => q.calls[0])).toEqual([["rpc", ["contacts_matching", contactMatchArgs("acct", "李"), { get: true }]]]);
    expect(queries.map(ors)).toEqual([[]]);
  });

  it("every tier keeps the list's rules: this account, no holding record, not archived, not merged away, sort_name then id, the limit", async () => {
    for (const term of ["ana", "maria5@example.com", "(956) 555-0199"]) {
      const { db, queries } = tieredDb();
      await searchContacts(db, "acct-1", { term, limit: 7 });
      expect(queries, term).toHaveLength(3);
      for (const q of queries) {
        const has = (c: Call) => expect(q.calls, `${term}, tier ${tierOf(q)}`).toContainEqual(c);
        has(["rpc", ["contacts_matching", contactMatchArgs("acct-1", term), { get: true }]]);
        expect(q.calls.some(([m]) => m === "from"), `${term}: never from("contacts")`).toBe(false);
        has(["eq", ["account_id", "acct-1"]]);
        has(["eq", ["holds_shared_number", false]]);
        has(["is", ["archived_at", null]]);
        has(["is", ["merged_into", null]]);
        expect(q.calls.filter(([m]) => m === "order")).toEqual([
          ["order", ["sort_name", { ascending: true, nullsFirst: false }]],
          ["order", ["id", { ascending: true }]],
        ]);
        has(["limit", [7]]);
        expect(q.calls.some(([m]) => m === "select")).toBe(true);
      }
    }
  });

  it('a term the sanitizer empties ("%", "()", "") is no search: [] and no query', async () => {
    for (const term of ["%", "()", ""]) {
      const { db, queries } = tieredDb();
      expect(await searchContacts(db, "acct", { term, limit: 5 }), term).toEqual([]);
      expect(queries, term).toEqual([]);
    }
  });
});

describe("searchContacts: merging the tiers", () => {
  const byTier: Record<1 | 2 | 3, string[]> = { 1: ["A"], 2: ["B", "A"], 3: ["C", "B", "D"] };

  it("best tier first, each person once, cut to the limit: [A] + [B, A] + [C, B, D] at 3 is [A, B, C] (mutations: no de-duplication -> FAILS; reverse the tiers -> FAILS)", async () => {
    const { db } = tieredDb((q) => ({ data: byTier[tierOf(q)].map((id) => ({ id })), error: null }));
    const rows = await searchContacts(db, "acct", { term: "ana", limit: 3 });
    expect(rows.map((r) => r.id)).toEqual(["A", "B", "C"]);
  });

  it("an error in ANY tier throws, never a shorter list that looks like fewer matches (mutation: skip the error check -> FAILS)", async () => {
    for (const bad of [1, 2, 3] as const) {
      const { db } = tieredDb((q) => tierOf(q) === bad
        ? { data: null, error: { message: `tier ${bad} broke` } }
        : { data: byTier[tierOf(q)].map((id) => ({ id })), error: null });
      await expect(searchContacts(db, "acct", { term: "ana", limit: 3 }), `tier ${bad}`)
        .rejects.toThrow(`searchContacts failed: tier ${bad} broke`);
    }
  });
});
