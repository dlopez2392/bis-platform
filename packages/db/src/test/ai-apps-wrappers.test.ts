import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_APP_LOG_KINDS, noteAiAppRead, readAiAppLog, readAiAppsSwitch, setAiAppsSwitch } from "../ai-apps";

/**
 * The typed wrappers over 20261119152434_ai_apps.sql. No database: a scripted client records every rpc, read and
 * update (name, columns, filters, order, limit) and answers a scripted { data, error } per call. A wrapper that sends a
 * wrong argument name, drops a filter, maps an unexpected error to a refusal, or passes an answer it did not expect
 * fails here by name. The SQL itself is ai-apps-schema.test.ts.
 */
type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Call = { op: string; table?: string; fn?: string; args?: unknown; cols?: string; patch?: unknown;
  filters: [string, string, unknown][]; order: [string, unknown][]; limit: number | null };

function fake(answers: Answer[]) {
  const calls: Call[] = [];
  const next = () => answers.shift() ?? { data: null, error: { message: "no scripted answer" } };
  const builder = (call: Call) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: (cols: string) => { call.cols = cols; return b; },
      eq: (c: string, v: unknown) => { call.filters.push(["eq", c, v]); return b; },
      is: (c: string, v: unknown) => { call.filters.push(["is", c, v]); return b; },
      not: (c: string, op: string, v: unknown) => { call.filters.push([`not.${op}`, c, v]); return b; },
      in: (c: string, v: unknown) => { call.filters.push(["in", c, v]); return b; },
      order: (c: string, o: unknown) => { call.order.push([c, o]); return b; },
      limit: (n: number) => { call.limit = n; return b; },
      maybeSingle: async () => next(),
      then: (res: (a: Answer) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej),
    });
    return b;
  };
  const db = {
    rpc: async (fn: string, args: unknown) => { calls.push({ op: "rpc", fn, args, filters: [], order: [], limit: null }); return next(); },
    from: (table: string) => ({
      select: (cols: string) => {
        const call: Call = { op: "select", table, cols, filters: [], order: [], limit: null };
        calls.push(call);
        return builder(call);
      },
      update: (patch: unknown) => {
        const call: Call = { op: "update", table, patch, filters: [], order: [], limit: null };
        calls.push(call);
        return builder(call);
      },
    }),
  } as unknown as SupabaseClient;
  return { db, calls };
}
const ok = (data: unknown): Answer => ({ data, error: null });
const READ = { accountId: "acct_1", actorClerkUserId: "user_1", actorName: "Dan Lopez", kind: "ai_app_appointments" as const,
  requestId: "11111111-1111-4111-8111-111111111111" };

describe("AI_APP_LOG_KINDS", () => {
  it("are the five kinds the migration's agency_visit_items_kind_check adds, in the plan's order", () => {
    expect(AI_APP_LOG_KINDS).toEqual(["ai_app_calls_and_messages", "ai_app_appointments", "ai_app_needs_attention",
      "ai_app_lookup_customer", "ai_app_my_businesses"]);
  });
});

describe("noteAiAppRead", () => {
  it("sends every argument by its SQL name and answers the visit id", async () => {
    const { db, calls } = fake([ok("v-1")]);
    expect(await noteAiAppRead(db, READ)).toEqual({ ok: true, visitId: "v-1" });
    expect(calls).toEqual([{ op: "rpc", fn: "note_ai_app_read", filters: [], order: [], limit: null, args: {
      p_account_id: "acct_1", p_actor: "user_1", p_actor_name: "Dan Lopez", p_kind: "ai_app_appointments",
      p_request_id: READ.requestId } }]);
  });

  it("maps the function's not_allowed refusal to { ok: false, reason: 'not_allowed' }", async () => {
    const { db } = fake([{ data: null, error: { code: "P0001", message: "note_ai_app_read: not_allowed" } }]);
    expect(await noteAiAppRead(db, READ)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("maps the function's rate_limited refusal to { ok: false, reason: 'rate_limited' } (mutation: map both messages to not_allowed -> FAILS)", async () => {
    const { db } = fake([{ data: null, error: { code: "P0001", message: "note_ai_app_read: rate_limited" } }]);
    expect(await noteAiAppRead(db, READ)).toEqual({ ok: false, reason: "rate_limited" });
  });

  it.each([
    ["a missing EXECUTE grant (42501)", { code: "42501", message: "permission denied for function note_ai_app_read" }],
    ["the null-argument guard", { code: "22004", message: "note_ai_app_read: a required argument is null" }],
    ["the refusal's words with another code", { code: "42501", message: "note_ai_app_read: not_allowed" }],
    ["a network failure", { message: "TypeError: fetch failed" }],
  ])("THROWS on any other error, never a refusal the route would show as 'ask the Owner': %s (mutation: map every error to not_allowed -> FAILS)", async (_n, error) => {
    const { db } = fake([{ data: null, error }]);
    await expect(noteAiAppRead(db, READ)).rejects.toThrow(`noteAiAppRead failed: ${error.message}`);
  });

  it("throws on an answer that is not a visit id", async () => {
    const { db } = fake([ok(null)]);
    await expect(noteAiAppRead(db, READ)).rejects.toThrow("noteAiAppRead: unexpected answer null");
  });
});

const ON = { ai_apps_enabled_at: "2026-11-19T15:00:00+00:00", ai_apps_changed_at: "2026-11-19T15:00:00+00:00", ai_apps_changed_by: "u-owner" };
const OFF = { ai_apps_enabled_at: null, ai_apps_changed_at: "2026-11-19T16:00:00+00:00", ai_apps_changed_by: "u-owner" };
const COLS = "ai_apps_enabled_at, ai_apps_changed_at, ai_apps_changed_by";

describe("readAiAppsSwitch", () => {
  it("answers the three columns by name", async () => {
    const { db, calls } = fake([ok(ON)]);
    expect(await readAiAppsSwitch(db, "acct_1")).toEqual({ enabledAt: ON.ai_apps_enabled_at, changedAt: ON.ai_apps_changed_at, changedBy: "u-owner" });
    expect(calls[0]).toMatchObject({ op: "select", table: "accounts", cols: COLS, filters: [["eq", "id", "acct_1"]] });
  });

  it("an account that does not exist (or that RLS hides) THROWS, never an all-null 'off'", async () => {
    const { db } = fake([ok(null)]);
    await expect(readAiAppsSwitch(db, "acct_gone")).rejects.toThrow("readAiAppsSwitch: no such account acct_gone");
  });
});

describe("setAiAppsSwitch", () => {
  it("on: one conditional UPDATE writing the switch, a fresh time and the Owner, answered from its own row (mutation: drop ai_apps_changed_by from the patch -> FAILS)", async () => {
    const { db, calls } = fake([ok([ON])]);
    expect(await setAiAppsSwitch(db, "acct_1", true, "u-owner")).toEqual({
      changed: true, state: { enabledAt: ON.ai_apps_enabled_at, changedAt: ON.ai_apps_changed_at, changedBy: "u-owner" } });
    expect(calls).toHaveLength(1);
    const patch = calls[0]!.patch as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(["ai_apps_changed_at", "ai_apps_changed_by", "ai_apps_enabled_at"]);
    expect(patch.ai_apps_changed_by).toBe("u-owner");
    expect(patch.ai_apps_enabled_at).toBe(patch.ai_apps_changed_at);
    expect(calls[0]).toMatchObject({ op: "update", table: "accounts", cols: COLS,
      filters: [["eq", "id", "acct_1"], ["is", "ai_apps_enabled_at", null]] });
  });

  it("off: the UPDATE clears the switch and is filtered to a switch that is on", async () => {
    const { db, calls } = fake([ok([OFF])]);
    expect((await setAiAppsSwitch(db, "acct_1", false, "u-owner")).changed).toBe(true);
    expect((calls[0]!.patch as Record<string, unknown>).ai_apps_enabled_at).toBeNull();
    expect(calls[0]!.filters).toEqual([["eq", "id", "acct_1"], ["not.is", "ai_apps_enabled_at", null]]);
  });

  it("asking for the state it is already in writes nothing and answers changed: false from ONE re-read", async () => {
    const { db, calls } = fake([ok([]), ok(OFF)]);
    expect(await setAiAppsSwitch(db, "acct_1", false, "u-owner")).toEqual({
      changed: false, state: { enabledAt: null, changedAt: OFF.ai_apps_changed_at, changedBy: "u-owner" } });
    expect(calls.map((c) => c.op)).toEqual(["update", "select"]);
  });

  it("an account that does not exist THROWS (mutation: answer the re-read's nulls -> FAILS)", async () => {
    const { db } = fake([ok([]), ok(null)]);
    await expect(setAiAppsSwitch(db, "acct_gone", true, "u-owner")).rejects.toThrow("setAiAppsSwitch: no such account acct_gone");
  });

  it("an empty Owner id is refused before anything is sent", async () => {
    const { db, calls } = fake([]);
    await expect(setAiAppsSwitch(db, "acct_1", true, "")).rejects.toThrow("setAiAppsSwitch: changedByUserId is required");
    expect(calls).toEqual([]);
  });

  it("a database refusal (the record or Owner guard) throws with its message", async () => {
    const { db } = fake([{ data: null, error: { code: "23514", message: "accounts: only the business's Owner turns AI apps on or off" } }]);
    await expect(setAiAppsSwitch(db, "acct_1", true, "u-staff")).rejects.toThrow("setAiAppsSwitch failed: accounts: only the business's Owner");
  });
});

describe("readAiAppLog", () => {
  const VISITS = [
    { id: "v2", actor_name: "Dan Lopez", started_at: "2026-11-19T15:02:00+00:00" },
    { id: "v1", actor_name: null, started_at: "2026-11-19T15:01:00+00:00" },
  ];
  const ITEMS = [{ visit_id: "v1", kind: "ai_app_lookup_customer" }, { visit_id: "v2", kind: "ai_app_appointments" }];

  it("reads this account's ai_app visits newest first, then their items, and answers who, which read and when in the visits' order (mutation: drop the actor_kind filter -> FAILS)", async () => {
    const { db, calls } = fake([ok(VISITS), ok(ITEMS)]);
    expect(await readAiAppLog(db, "acct_1", 20)).toEqual([
      { who: "Dan Lopez", kind: "ai_app_appointments", at: "2026-11-19T15:02:00+00:00" },
      { who: null, kind: "ai_app_lookup_customer", at: "2026-11-19T15:01:00+00:00" },
    ]);
    expect(calls[0]).toEqual({ op: "select", table: "agency_visits", cols: "id, actor_name, started_at",
      filters: [["eq", "account_id", "acct_1"], ["eq", "actor_kind", "ai_app"]],
      order: [["started_at", { ascending: false }], ["id", { ascending: false }]], limit: 20 });
    expect(calls[1]).toEqual({ op: "select", table: "agency_visit_items", cols: "visit_id, kind",
      filters: [["eq", "account_id", "acct_1"], ["in", "visit_id", ["v2", "v1"]], ["in", "kind", [...AI_APP_LOG_KINDS]]],
      order: [], limit: null });
  });

  it("no visits: one read, no item read, []", async () => {
    const { db, calls } = fake([ok([])]);
    expect(await readAiAppLog(db, "acct_1", 20)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("a visit without its item throws: every note_ai_app_read writes both in one statement", async () => {
    const { db } = fake([ok(VISITS), ok([ITEMS[1]])]);
    await expect(readAiAppLog(db, "acct_1", 20)).rejects.toThrow("readAiAppLog: visit v1 has no ai_app item");
  });

  it.each([0, 101, 2.5])("refuses a limit of %s (1 to 100)", async (n) => {
    const { db, calls } = fake([]);
    await expect(readAiAppLog(db, "acct_1", n)).rejects.toThrow("readAiAppLog: limit must be a whole number from 1 to 100");
    expect(calls).toEqual([]);
  });

  it("an error on either read throws, naming it", async () => {
    const { db } = fake([{ data: null, error: { message: "boom" } }]);
    await expect(readAiAppLog(db, "acct_1", 20)).rejects.toThrow("readAiAppLog failed: boom");
  });
});
