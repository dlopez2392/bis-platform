import { describe, it, expect, vi } from "vitest";
import type { Proposal } from "@bis/db/proposal-rules";
import type { Db } from "./kinds/types";
import { readAgencySuggestionContext } from "./view-reads";
import { rows as SG } from "@/components/proposals/suggestion-specimens";

/**
 * The agency Work page's context for its cards (item 8b-2, spec 5.2), on the service client: the stage
 * names per account, ONE persona read for every account, ONE calls read. A fake client that records every
 * read it was asked for (table, filters) and answers per table.
 */
type Answer = { data?: unknown[]; error?: { message: string } };
type Read = { table: string; cols: string; eq: [string, unknown][]; in: [string, unknown[]][]; limit: number | null };
function serviceDb(answers: Partial<Record<string, Answer | ((read: Read) => Answer)>>) {
  const reads: Read[] = [];
  const client = {
    from(table: string) {
      const read: Read = { table, cols: "", eq: [], in: [], limit: null };
      reads.push(read);
      const settle = async () => {
        const a = answers[table];
        const res = typeof a === "function" ? a(read) : (a ?? { data: [] });
        return { data: res.data ?? null, error: res.error ?? null };
      };
      const chain = {
        select: (cols: string) => { read.cols = cols; return chain; },
        eq: (col: string, v: unknown) => { read.eq.push([col, v]); return chain; },
        in: (col: string, v: unknown[]) => { read.in.push([col, v]); return chain; },
        limit: (n: number) => { read.limit = n; return settle(); },
      };
      return chain;
    },
  };
  return { db: client as unknown as Db, reads };
}

const at = (accountId: string, id: string, over: Partial<Proposal> = {}): Proposal =>
  ({ ...SG.pending, id, accountId, callId: `call_${accountId}`, ...over } as Proposal);
const stageAt = (accountId: string, id: string, opportunityId: string): Proposal =>
  ({ ...SG.stage, id, accountId, callId: `call_${accountId}`, payload: { opportunityId, fromStageId: "st_new", toStageId: "st_quote" } });

const THREE = [at("acc_a", "a1"), at("acc_b", "b1"), at("acc_c", "c1"), at("acc_a", "a2")];
const CALLS: Answer = { data: [
  { id: "call_acc_a", account_id: "acc_a", started_at: "2026-10-14T14:42:00.000Z", contact_id: "con_a" },
  { id: "call_acc_b", account_id: "acc_b", started_at: "2026-10-13T14:42:00.000Z", contact_id: null },
  { id: "call_acc_c", account_id: "acc_c", started_at: null, contact_id: "con_c" },
] };

describe("readAgencySuggestionContext", () => {
  it("reads every account's persona in ONE read, and an account with no profile is Sofía (mutation: one read per account -> FAILS)", async () => {
    const s = serviceDb({ calls: CALLS, voice_profiles: { data: [{ account_id: "acc_a", persona_name: "Rosa" }, { account_id: "acc_b", persona_name: "  " }] } });
    const ctx = await readAgencySuggestionContext(s.db, THREE);
    const personas = s.reads.filter((r) => r.table === "voice_profiles");
    expect(personas).toEqual([{ table: "voice_profiles", cols: "account_id, persona_name", eq: [], in: [["account_id", ["acc_a", "acc_b", "acc_c"]]], limit: 3 }]);
    expect([...ctx.personaByAccount]).toEqual([["acc_a", "Rosa"], ["acc_b", "Sofía"], ["acc_c", "Sofía"]]);
  });

  it("a failed persona read is Sofía for every account, never the section's error (mutation: let it throw -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const s = serviceDb({ calls: CALLS, voice_profiles: { error: { message: "profiles down" } } });
      const ctx = await readAgencySuggestionContext(s.db, THREE);
      expect([...ctx.personaByAccount]).toEqual([["acc_a", "Sofía"], ["acc_b", "Sofía"], ["acc_c", "Sofía"]]);
      expect(errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n")).toContain("profiles down");
    } finally { errors.mockRestore(); }
  });

  it("reads every row's call in ONE read, and keeps a call only under the account of the rows that cite it (mutation: drop the account check -> FAILS)", async () => {
    // The read is cross-tenant (no account filter can serve three accounts), so the account check stands in
    // for one: acc_b's row cites call_acc_c, which the read answers as acc_c's. 0088's composite FK makes that
    // unreachable today; if it ever happened, acc_b's card must not borrow acc_c's day or caller.
    const list = [at("acc_a", "a1"), at("acc_b", "b1", { callId: "call_acc_c" }), at("acc_a", "a2")];
    const s = serviceDb({ calls: CALLS });
    const ctx = await readAgencySuggestionContext(s.db, list);
    expect(s.reads.filter((r) => r.table === "calls")).toEqual([
      { table: "calls", cols: "id, account_id, started_at, contact_id", eq: [], in: [["id", ["call_acc_a", "call_acc_c"]]], limit: 2 },
    ]);
    expect([...ctx.callsById]).toEqual([["call_acc_a", { startedAt: "2026-10-14T14:42:00.000Z", contactId: "con_a" }]]);
  });

  it("reads stages only for the accounts with a stage suggestion, each on its own account with its own deals (mutation: pass every account's rows -> FAILS)", async () => {
    const list = [stageAt("acc_a", "a1", "opp_a"), at("acc_b", "b1"), stageAt("acc_c", "c1", "opp_c")];
    const s = serviceDb({
      calls: CALLS,
      opportunities: (r) => ({ data: (r.in[0]![1] as string[]).map((id) => ({ id, pipeline_id: `pl_${id}` })) }),
      pipeline_stages: (r) => ({ data: [{ id: `st_${String(r.eq[0]![1])}`, name: `Stage of ${String(r.eq[0]![1])}`, position: 1, pipeline_id: (r.in[0]![1] as string[])[0] }] }),
    });
    const ctx = await readAgencySuggestionContext(s.db, list);
    expect(s.reads.filter((r) => r.table === "opportunities").map((r) => [r.eq, r.in])).toEqual([
      [[["account_id", "acc_a"]], [["id", ["opp_a"]]]],
      [[["account_id", "acc_c"]], [["id", ["opp_c"]]]],
    ]);
    expect([...ctx.stagesByAccount.keys()]).toEqual(["acc_a", "acc_c"]);
    expect(ctx.stagesByAccount.get("acc_c")!.stages).toEqual({ st_acc_c: { name: "Stage of acc_c", position: 1 } });
  });

  it("a failed stage read is the section's error: it throws (mutation: swallow it -> FAILS)", async () => {
    const s = serviceDb({ calls: CALLS, opportunities: { error: { message: "deals down" } } });
    await expect(readAgencySuggestionContext(s.db, [stageAt("acc_a", "a1", "opp_a")])).rejects.toThrow("deals down");
  });

  it("a failed calls read is the section's error: it throws", async () => {
    const s = serviceDb({ calls: { error: { message: "calls down" } } });
    await expect(readAgencySuggestionContext(s.db, THREE)).rejects.toThrow("calls down");
  });

  it("no rows, no reads", async () => {
    const s = serviceDb({});
    const ctx = await readAgencySuggestionContext(s.db, []);
    expect([s.reads, ctx.callsById.size, ctx.personaByAccount.size, ctx.stagesByAccount.size]).toEqual([[], 0, 0, 0]);
  });
});
