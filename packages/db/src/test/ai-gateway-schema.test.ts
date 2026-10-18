import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0086 (item 8a-1, spec 3.3; plan deviations 1, 2, 11, 12, 13): the ledger has no column that could
 * hold a prompt or an output; the switches and the budget; the agency alone reads all three tables;
 * the client role writes nothing and executes neither function; the gate reads the defaults, the
 * month and the day; the record writes one row and moves the counters forward only.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_aig_${RUN}`;
const AGENCY = { app_role: "agency_admin", sub: `u_aig_agency_${RUN}` };

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}

async function seed(c: Client): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'AIG Co',true) returning id", [agency!.id, ORG]);
  return a!.id;
}

const gate = async (c: Client, acct: string, month = "2026-10", day = "2026-10-18") =>
  (await c.query<{ r: Record<string, unknown> }>("select public.ai_gate_check($1, $2, $3) as r", [acct, month, day])).rows[0]!.r;

type Rec = { feature: string; model: string; inTok: number | null; outTok: number | null; cost: number; outcome: string; latency: number; month: string; day: string };
const record = (c: Client, acct: string, o: Partial<Rec> = {}) => {
  const v: Rec = { feature: "call_summary", model: "gpt-4o-mini", inTok: 100, outTok: 20, cost: 27, outcome: "ok", latency: 5, month: "2026-10", day: "2026-10-18", ...o };
  return c.query("select public.ai_ledger_record($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [acct, v.feature, v.model, v.inTok, v.outTok, v.cost, v.outcome, v.latency, v.month, v.day]);
};
/** [p_month, p_day] pairs both functions refuse with 22023: not a month, not a day, a day outside the month, a day past the month's end. */
const BAD_PERIODS: [string, string][] = [
  ["2026-13", "2026-13-01"], ["9999-99", "9999-99-01"], ["2026-1", "2026-1-01"], ["2026-10 ", "2026-10 -01"],
  ["2026-10", "2026-10-32"], ["2026-10", "2026-10-3x"], ["2026-10", "2026-10-1"], ["2026-10", "2026-10-18 "], ["2026-10", "2026-10-00"],
  ["2026-10", "2026-11-01"], ["2026-11", "2026-10-31"],
  ["2026-02", "2026-02-30"], ["2026-02", "2026-02-29"], ["2026-04", "2026-04-31"],
];
const counters = async (c: Client, acct: string) =>
  (await c.query<{ m: string | null; s: string; d: string | null; t: number }>(
    "select month_key as m, month_spend_microusd::text as s, day_key as d, record_summaries_today as t from account_ai_settings where account_id = $1", [acct])).rows[0];

describe("0086: the tables (spec 3.3)", () => {
  it("the ledger's columns are exactly these: nothing could hold a prompt or an output (mutation: add `prompt text` to ai_ledger -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        "select column_name as n from information_schema.columns where table_schema = 'public' and table_name = 'ai_ledger' order by ordinal_position");
      expect(rows.map((r) => r.n)).toEqual(["id", "account_id", "feature", "model", "input_tokens", "output_tokens", "cost_microusd", "outcome", "latency_ms", "created_at"]);
    }));

  it("the model id is at most 64 characters (plan deviation 11; mutation: drop ai_ledger_model_check -> the 65-character model is stored -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome) values ($1, 'call_summary', $2, 'ok')", [acct, "m".repeat(65)]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_model_check" });
    }));

  it("features and outcomes are closed sets, gate_unreadable included (plan deviation 2; mutations: drop either check -> the 'chat' / 'maybe' insert succeeds -> FAILS; leave gate_unreadable out of the outcome list -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      const ins = (feature: string, outcome: string) =>
        attempt(c, "insert into ai_ledger (account_id, feature, model, outcome) values ($1, $2, 'gpt-4o-mini', $3)", [acct, feature, outcome]);
      for (const f of ["call_summary", "call_proposals", "call_card", "record_summary"]) await ins(f, "ok");
      for (const o of ["global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"]) await ins("call_card", o);
      await expect(ins("chat", "ok")).rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_feature_check" });
      await expect(ins("call_card", "maybe")).rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_outcome_check" });
    }));

  it("tokens, cost and latency are never negative (mutation: drop ai_ledger_cost_check -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome, cost_microusd) values ($1, 'call_card', 'gpt-4o-mini', 'ok', -1)", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_cost_check" });
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome, input_tokens) values ($1, 'call_card', 'gpt-4o-mini', 'ok', -1)", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_input_tokens_check" });
    }));

  it("a budget runs from 0 to 100000 cents (mutation: drop account_ai_settings_budget_check -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await attempt(c, "insert into account_ai_settings (account_id, monthly_budget_cents) values ($1, 0)", [acct]);
      await expect(attempt(c, "update account_ai_settings set monthly_budget_cents = 100001 where account_id = $1", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "account_ai_settings_budget_check" });
      await expect(attempt(c, "update account_ai_settings set monthly_budget_cents = -1 where account_id = $1", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "account_ai_settings_budget_check" });
    }));

  it("a stored month or day key is a real month and day, never '2026-13' or '9999-99' (fix round; mutations: either check back to digits-and-hyphens only -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await attempt(c, "insert into account_ai_settings (account_id, month_key, day_key) values ($1, '2026-12', '2026-12-31')", [acct]);
      for (const m of ["2026-13", "9999-99", "2026-00"])
        await expect(attempt(c, "update account_ai_settings set month_key = $2 where account_id = $1", [acct, m]))
          .rejects.toMatchObject({ code: "23514", constraint: "account_ai_settings_month_key_check" });
      for (const d of ["2026-10-32", "2026-13-01", "2026-10-00"])
        await expect(attempt(c, "update account_ai_settings set day_key = $2 where account_id = $1", [acct, d]))
          .rejects.toMatchObject({ code: "23514", constraint: "account_ai_settings_day_key_check" });
    }));

  it("the global switch is one row, seeded on (mutations: drop ai_gateway_settings_singleton -> FAILS; seed it off -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ id: boolean; enabled: boolean }>("select id, enabled from ai_gateway_settings");
      expect(rows).toEqual([{ id: true, enabled: true }]);
      await expect(attempt(c, "insert into ai_gateway_settings (id, enabled) values (false, true)"))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_gateway_settings_singleton" });
    }));

  it("deleting the account deletes its ledger rows and its settings (mutation: drop on delete cascade on either FK -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct);
      await c.query("delete from accounts where id = $1", [acct]);
      const { rows: [n] } = await c.query<{ l: string; s: string }>(
        "select (select count(*) from ai_ledger where account_id = $1)::text as l, (select count(*) from account_ai_settings where account_id = $1)::text as s", [acct]);
      expect(n).toEqual({ l: "0", s: "0" });
    }));

  it("the teardown list carries both account tables first, and not the global row (spec 3.3; mutation: drop either name -> FAILS)", () => {
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
    expect((ACCOUNT_OWNED_TABLES as readonly string[]).includes("ai_gateway_settings")).toBe(false);
  });
});

describe("0086: who reads, who writes (spec 3.3, G6)", () => {
  const counts = async (c: Client, acct: string) => {
    const { rows: [n] } = await c.query<{ l: string; s: string; g: string }>(
      `select (select count(*) from ai_ledger where account_id = $1)::text as l,
              (select count(*) from account_ai_settings where account_id = $1)::text as s,
              (select count(*) from ai_gateway_settings)::text as g`, [acct]);
    await c.query("reset role");
    return n;
  };

  it("the agency reads all three (mutation: drop policy ai_ledger_agency_read -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct);
      await actAs(c, AGENCY);
      expect(await counts(c, acct)).toEqual({ l: "1", s: "1", g: "1" });
    }));

  it("the account's own Owner reads none of them: clients never see a meter (mutations: any of the three policies as `using (true)`; the two account policies as `using (account_id = app.current_account_id())` -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct);
      await actAsMember(c, acct, ORG, "owner");
      expect(await counts(c, acct)).toEqual({ l: "0", s: "0", g: "0" });
    }));

  it("anon and authenticated write nothing and anon reads nothing; service_role holds all four (mutation: grant insert on ai_ledger to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(`
        select r || ' ' || t || ' ' || p || ' ' || has_table_privilege(r, 'public.' || t, p)::text as x
          from (values ('anon'), ('authenticated'), ('service_role')) a(r)
         cross join (values ('ai_ledger'), ('account_ai_settings'), ('ai_gateway_settings')) b(t)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) d(p)`);
      const has = (r: string, t: string, p: string) => rows.some((x) => x.x === `${r} ${t} ${p} true`);
      const tables = ["ai_ledger", "account_ai_settings", "ai_gateway_settings"];
      for (const t of tables) {
        for (const p of ["INSERT", "UPDATE", "DELETE"]) expect([t, p, has("anon", t, p), has("authenticated", t, p)]).toEqual([t, p, false, false]);
        expect([t, has("anon", t, "SELECT"), has("authenticated", t, "SELECT")]).toEqual([t, false, true]);
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect([t, p, has("service_role", t, p)]).toEqual([t, p, true]);
      }
    }));

  // The message, not only the code: with the grant, RLS (no insert policy) still refuses, and an RLS
  // refusal is ALSO 42501 ("new row violates row-level security policy"), so a code-only match could
  // not fail on the grant mutation (run on the replica, Task 1 probe d).
  it("an Owner's insert is refused by the grant itself, before RLS (mutation: grant insert on ai_ledger to authenticated -> RLS refuses instead, with its own message -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await actAsMember(c, acct, ORG, "owner");
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome) values ($1, 'call_card', 'gpt-4o-mini', 'ok')", [acct]))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table ai_ledger" });
    }));

  it("both functions are service_role only, security definer, with an empty search path (plan deviation 1; mutations: grant execute to authenticated; set search_path = public -> FAILS)", () =>
    withRollback(async (c) => {
      const sigs = ["public.ai_gate_check(uuid, text, text)", "public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text)"];
      for (const s of sigs) {
        const { rows: [p] } = await c.query<{ a: boolean; n: boolean; s: boolean }>(
          "select has_function_privilege('authenticated', $1, 'execute') as a, has_function_privilege('anon', $1, 'execute') as n, has_function_privilege('service_role', $1, 'execute') as s", [s]);
        expect([s, p]).toEqual([s, { a: false, n: false, s: true }]);
      }
      const { rows } = await c.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        "select proname, prosecdef, proconfig from pg_proc where proname in ('ai_gate_check', 'ai_ledger_record') order by proname");
      // Assumption A2: PG renders `set search_path = ''` as search_path="". If it differs, paste the real value.
      expect(rows).toEqual([
        { proname: "ai_gate_check", prosecdef: true, proconfig: ['search_path=""'] },
        { proname: "ai_ledger_record", prosecdef: true, proconfig: ['search_path=""'] },
      ]);
    }));
});

describe("0086: ai_gate_check (spec 3.1 step 3, 3.3; plan deviation 13)", () => {
  it("an account with no settings row gets the defaults: on, $10, nothing spent (mutation: coalesce(v_s.enabled, false) -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      expect(await gate(c, acct)).toEqual({ global_enabled: true, account_enabled: true, budget_microusd: 10000000, month_spend_microusd: 0, record_summaries_today: 0 });
    }));

  it("reads this month's spend and today's summaries, and zero for any other month or day (mutation: drop the month_key compare -> the November read sees 27 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { cost: 27 });
      await record(c, acct, { feature: "record_summary", cost: 30 });
      expect(await gate(c, acct)).toMatchObject({ month_spend_microusd: 57, record_summaries_today: 1 });
      expect(await gate(c, acct, "2026-11", "2026-11-01")).toMatchObject({ month_spend_microusd: 0, record_summaries_today: 0 });
      expect(await gate(c, acct, "2026-10", "2026-10-19")).toMatchObject({ month_spend_microusd: 57, record_summaries_today: 0 });
    }));

  it("the account's switch and budget, in micro-dollars (mutation: budget * 100 instead of * 10000 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await c.query("insert into account_ai_settings (account_id, enabled, monthly_budget_cents) values ($1, false, 500)", [acct]);
      expect(await gate(c, acct)).toMatchObject({ account_enabled: false, budget_microusd: 5000000 });
    }));

  it("the global switch, and OFF when its row is missing: fail closed (mutation: coalesce(v_global, true) -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await c.query("update ai_gateway_settings set enabled = false");
      expect((await gate(c, acct)).global_enabled).toBe(false);
      await c.query("delete from ai_gateway_settings");
      expect((await gate(c, acct)).global_enabled).toBe(false);
    }));

  it("refuses a null argument (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(attempt(c, "select public.ai_gate_check(null, '2026-10', '2026-10-18')")).rejects.toMatchObject({ code: "22004" });
    }));

  it("refuses a month that is not real, a day that is not real, and a day outside the month, and takes a leap day (fix round; mutations: drop the month check; drop the day pattern; drop the day-in-month check; drop the real-day check -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      for (const [m, d] of BAD_PERIODS)
        await expect([m, d, await attempt(c, "select public.ai_gate_check($1, $2, $3)", [acct, m, d]).then(() => "accepted", (e) => e.code)])
          .toEqual([m, d, "22023"]);
      expect(await gate(c, acct, "2028-02", "2028-02-29")).toMatchObject({ month_spend_microusd: 0 });
    }));

  it("a lagging instance asking for an OLDER month than the stored one reads the stored spend and count, not zero (fix round; mutation: back to `month_key = p_month` -> reads 0 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { feature: "record_summary", cost: 5, month: "2026-11", day: "2026-11-01" });
      expect(await gate(c, acct, "2026-10", "2026-10-31")).toMatchObject({ month_spend_microusd: 5, record_summaries_today: 1 });
    }));
});

describe("0086: ai_ledger_record (spec 3.1 step 6, 3.3; plan deviation 12)", () => {
  it("writes exactly one row with what it was given, null tokens allowed (mutation: insert 0 for a null token -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { feature: "call_card", inTok: null, outTok: null, cost: 0, outcome: "timeout", latency: 10001 });
      const { rows } = await c.query(
        "select feature, model, input_tokens, output_tokens, cost_microusd::text as cost, outcome, latency_ms from ai_ledger where account_id = $1", [acct]);
      expect(rows).toEqual([{ feature: "call_card", model: "gpt-4o-mini", input_tokens: null, output_tokens: null, cost: "0", outcome: "timeout", latency_ms: 10001 }]);
    }));

  it("adds within a month, resets on a newer month, and never rewinds on an older one (mutation: drop the older-key branch -> the late October row resets to 2026-10 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { cost: 27 });
      await record(c, acct, { cost: 30 });
      expect(await counters(c, acct)).toMatchObject({ m: "2026-10", s: "57" });
      await record(c, acct, { cost: 5, month: "2026-11", day: "2026-11-01" });
      expect(await counters(c, acct)).toMatchObject({ m: "2026-11", s: "5" });
      await record(c, acct, { cost: 9, month: "2026-10", day: "2026-10-31" });
      expect(await counters(c, acct)).toMatchObject({ m: "2026-11", s: "5", d: "2026-11-01" });
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from ai_ledger where account_id = $1", [acct]);
      expect(n!.n).toBe("4");
    }));

  it("counts only a successful record_summary toward today, and resets on a new day (spec choice I8; mutations: count any outcome; count any feature -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { feature: "record_summary", outcome: "ok" });
      await record(c, acct, { feature: "record_summary", outcome: "provider_error", inTok: null, outTok: null, cost: 0 });
      await record(c, acct, { feature: "call_summary", outcome: "ok" });
      expect(await counters(c, acct)).toMatchObject({ d: "2026-10-18", t: 1 });
      await record(c, acct, { feature: "record_summary", outcome: "ok", day: "2026-10-19" });
      expect(await counters(c, acct)).toMatchObject({ d: "2026-10-19", t: 1 });
    }));

  it("refuses a null argument (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await expect(attempt(c, "select public.ai_ledger_record($1, 'call_card', 'gpt-4o-mini', 1, 1, null, 'ok', 1, '2026-10', '2026-10-18')", [acct]))
        .rejects.toMatchObject({ code: "22004" });
    }));

  it("refuses a month that is not real, a day that is not real, and a day outside the month, writing nothing; takes a leap day (fix round; mutations: drop the month check; drop the day pattern; drop the day-in-month check; drop the real-day check -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      for (const [m, d] of BAD_PERIODS)
        await expect([m, d, await attempt(c, "select public.ai_ledger_record($1, 'call_card', 'gpt-4o-mini', 1, 1, 1, 'ok', 1, $2, $3)", [acct, m, d]).then(() => "accepted", (e) => e.code)])
          .toEqual([m, d, "22023"]);
      expect(await counters(c, acct)).toBeUndefined();
      await record(c, acct, { month: "2028-02", day: "2028-02-29" });
      expect(await counters(c, acct)).toMatchObject({ m: "2028-02", d: "2028-02-29" });
    }));
});
