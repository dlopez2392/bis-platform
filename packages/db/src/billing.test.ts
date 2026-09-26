import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countBilledAccountsByPlan } from "./billing";

describe("countBilledAccountsByPlan", () => {
  it("pages until an EMPTY page, so a server max_rows below the page size can never truncate the count (PR-1 final review) (mutation: one unpaged read → only the first page is counted, FAILS; stop on a short page → FAILS)", async () => {
    const ranges: [number, number][] = [];
    const page = (n: number, planId: string) => Array.from({ length: n }, (_, i) => ({ account_id: `a_${planId}_${i}`, plan_id: planId }));
    const pages = [page(1000, "p1"), page(3, "p2"), []];
    const chain = {
      select: () => chain, order: () => chain,
      range: async (a: number, b: number) => { ranges.push([a, b]); return { data: pages[ranges.length - 1] ?? [], error: null }; },
    };
    expect(await countBilledAccountsByPlan({ from: () => chain } as unknown as SupabaseClient)).toEqual({ p1: 1000, p2: 3 });
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1003, 2002]]);
  });
});
