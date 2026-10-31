import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchGroups } from "./client-groups";

/**
 * F-092 part 1 (plan Task 11, owner Q4): a household or business is found the same way a contact is —
 * ignoring accents and word order — by adding the folded search_name words (0108) beside today's raw `name`
 * arm, never replacing it, so nothing findable today is lost. Pure: no Supabase variable in this shell. The
 * live proof (a real household found by "familia garcia", "garcia familia" and "GARCIA") is
 * src/test/client-groups.test.ts (CI-only, not run from here).
 */

/** A fake client that records every call; awaiting it answers an empty page. */
function recordingDb() {
  const calls: [string, unknown[]][] = [];
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy; };
    },
  });
  return { db: proxy as SupabaseClient, calls };
}

describe("searchGroups: the exact .or() argument (mutation: drop the token arm -> FAILS)", () => {
  it('"familia garcía" keeps the raw name arm and ADDS an and() of the folded words', async () => {
    const { db, calls } = recordingDb();
    await searchGroups(db, "acct", "familia garcía");
    const orCalls = calls.filter(([m]) => m === "or");
    expect(orCalls).toEqual([
      ["or", ["name.ilike.%familia garcía%,and(search_name.ilike.%familia%,search_name.ilike.%garcia%)"]],
    ]);
  });

  it('"roof" is one word: a bare search_name arm, no and()', async () => {
    const { db, calls } = recordingDb();
    await searchGroups(db, "acct", "roof");
    const orCalls = calls.filter(([m]) => m === "or");
    expect(orCalls).toEqual([["or", ["name.ilike.%roof%,search_name.ilike.%roof%"]]]);
  });

  it("ñ and n match both ways (Q1): the folded word carries n, not ñ", async () => {
    const { db, calls } = recordingDb();
    await searchGroups(db, "acct", "Peña");
    const orCalls = calls.filter(([m]) => m === "or");
    expect(orCalls).toEqual([["or", ["name.ilike.%Peña%,search_name.ilike.%pena%"]]]);
  });

  it("a name with no [a-z0-9] content folds to no words: only the raw name arm", async () => {
    const { db, calls } = recordingDb();
    await searchGroups(db, "acct", "李");
    const orCalls = calls.filter(([m]) => m === "or");
    expect(orCalls).toEqual([["or", ["name.ilike.%李%"]]]);
  });

  it('"%" sanitizes to no real content: no query at all, not even a bare match-everything or() (mutation: drop the !s guard -> FAILS)', async () => {
    const { db, calls } = recordingDb();
    expect(await searchGroups(db, "acct", "%")).toEqual([]);
    expect(calls.some(([m]) => m === "or")).toBe(false);
    expect(calls.some(([m]) => m === "from")).toBe(false);
  });

  it("blank (whitespace only) means no query, before sanitizing even runs", async () => {
    const { db, calls } = recordingDb();
    expect(await searchGroups(db, "acct", "   ")).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("order and limit are unchanged: name_key ascending, limit 8", async () => {
    const { db, calls } = recordingDb();
    await searchGroups(db, "acct", "familia");
    expect(calls.filter(([m]) => m === "order")).toEqual([["order", ["name_key", { ascending: true }]]]);
    expect(calls.filter(([m]) => m === "limit")).toEqual([["limit", [8]]]);
  });
});
