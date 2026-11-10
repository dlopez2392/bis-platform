import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";

/**
 * 0116 (record token use on every call, owner 2026-11-10): `call_usage` holds one row per call with the
 * Realtime model's token counts, the caller-speech transcription's tokens or seconds, and an ESTIMATED cost.
 * It is BIS's own cost data: the agency reads it, no client role reads it at all, and only service_role
 * writes it.
 *
 * RED BEFORE APPLY, legitimately: every case below (the table does not exist; each fails on 42P01
 * "relation \"call_usage\" does not exist" or on an empty column list). Nothing here is green before 0116.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_cu_${RUN}`;
const AGENCY = { app_role: "agency_admin", sub: `u_cu_agency_${RUN}` };

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

/** An account and one call on it, as the table owner. */
async function seed(c: Client, org = ORG): Promise<{ acct: string; call: string }> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'CU Co',true) returning id", [agency!.id, org]);
  const e164 = `+999${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  const { rows: [p] } = await c.query<{ id: string }>(
    "insert into phone_numbers (account_id, e164) values ($1, $2) returning id", [a!.id, e164]);
  const { rows: [call] } = await c.query<{ id: string }>(
    "insert into calls (account_id, phone_number_id) values ($1, $2) returning id", [a!.id, p!.id]);
  return { acct: a!.id, call: call!.id };
}

/** One usage row for the call, optionally with one column set; through a savepoint, so a refusal is not the end of the transaction. */
const insertUsage = (c: Client, call: string, acct: string, col?: string, val?: unknown) =>
  col
    ? attempt(c, `insert into call_usage (call_id, account_id, model, ${col}) values ($1, $2, 'gpt-realtime', $3)`, [call, acct, val])
    : attempt(c, "insert into call_usage (call_id, account_id, model) values ($1, $2, 'gpt-realtime')", [call, acct]);

const COUNT_COLUMNS = [
  "responses", "input_text_tokens", "input_audio_tokens", "input_cached_text_tokens", "input_cached_audio_tokens",
  "output_text_tokens", "output_audio_tokens", "transcribe_input_tokens", "transcribe_output_tokens",
  "transcribe_seconds", "est_cost_microusd",
] as const;

describe("0116: the table", () => {
  it("its columns are exactly these, in this order (mutation: add `prompt text` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string; t: string; nul: string; d: string | null }>(
        `select column_name as n, data_type as t, is_nullable as nul, column_default as d from information_schema.columns
          where table_schema = 'public' and table_name = 'call_usage' order by ordinal_position`);
      expect(rows.map((r) => `${r.n} ${r.t} ${r.nul} ${r.d ?? "-"}`)).toEqual([
        "call_id uuid NO -",
        "account_id uuid NO -",
        "model text NO -",
        "responses integer NO 0",
        "input_text_tokens integer NO 0",
        "input_audio_tokens integer NO 0",
        "input_cached_text_tokens integer NO 0",
        "input_cached_audio_tokens integer NO 0",
        "output_text_tokens integer NO 0",
        "output_audio_tokens integer NO 0",
        "transcribe_model text YES -",
        "transcribe_input_tokens integer YES -",
        "transcribe_output_tokens integer YES -",
        "transcribe_seconds numeric YES -",
        "est_cost_microusd bigint NO 0",
        "created_at timestamp with time zone NO now()",
      ]);
    }));

  it("one row per call: call_id is the primary key, so a second plain insert is refused 23505 and `on conflict do nothing` writes nothing (mutation: drop the primary key -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await insertUsage(c, call, acct, "input_audio_tokens", 100);
      await expect(insertUsage(c, call, acct, "input_audio_tokens", 999))
        .rejects.toMatchObject({ code: "23505", constraint: "call_usage_pkey" });
      const r = await attempt(c,
        "insert into call_usage (call_id, account_id, model, input_audio_tokens) values ($1, $2, 'gpt-realtime', 999) on conflict (call_id) do nothing", [call, acct]);
      expect(r.rowCount).toBe(0);
      const { rows } = await c.query<{ n: string; a: number }>(
        "select count(*)::text as n, max(input_audio_tokens) as a from call_usage where call_id = $1", [call]);
      expect(rows[0]).toEqual({ n: "1", a: 100 });
    }));

  it("every count and the cost refuse a negative, each by its own check (mutation: drop any one check -> FAILS naming the column)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      const got: string[] = [];
      for (const col of COUNT_COLUMNS) {
        const code = await insertUsage(c, call, acct, col, -1).then(() => "accepted", (e) => `${e.code} ${e.constraint}`);
        got.push(`${col}: ${code}`);
      }
      expect(got).toEqual(COUNT_COLUMNS.map((col) => `${col}: 23514 call_usage_${col}_check`));
      // Zero is a real answer, not a refusal.
      for (const col of COUNT_COLUMNS) {
        await insertUsage(c, call, acct, col, 0);
        await c.query("delete from call_usage where call_id = $1", [call]);
      }
    }));

  it("a model id is 1 to 64 characters, and so is a transcription model when there is one (mutations: drop call_usage_model_check or call_usage_transcribe_model_check -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await expect(attempt(c, "insert into call_usage (call_id, account_id, model) values ($1, $2, $3)", [call, acct, "m".repeat(65)]))
        .rejects.toMatchObject({ code: "23514", constraint: "call_usage_model_check" });
      await expect(attempt(c, "insert into call_usage (call_id, account_id, model) values ($1, $2, '')", [call, acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "call_usage_model_check" });
      await expect(insertUsage(c, call, acct, "transcribe_model", "t".repeat(65)))
        .rejects.toMatchObject({ code: "23514", constraint: "call_usage_transcribe_model_check" });
      await expect(insertUsage(c, call, acct, "transcribe_model", ""))
        .rejects.toMatchObject({ code: "23514", constraint: "call_usage_transcribe_model_check" });
      await insertUsage(c, call, acct, "transcribe_model", "m".repeat(64));
    }));

  it("a deleted call takes its usage row with it, and so does a deleted account (mutation: drop on delete cascade on call_id -> the call delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const a = await seed(c);
      const b = await seed(c, `${ORG}_b`);
      await insertUsage(c, a.call, a.acct);
      await insertUsage(c, b.call, b.acct);
      await c.query("delete from calls where id = $1", [a.call]);
      // calls.account_id is restrict (0019), so the account goes after its calls, as the teardown does it.
      await c.query("delete from calls where account_id = $1", [b.acct]);
      await c.query("delete from phone_numbers where account_id = $1", [b.acct]);
      const { rows } = await c.query<{ n: string }>(
        "select count(*)::text as n from call_usage where call_id = any($1)", [[a.call, b.call]]);
      expect(rows[0]!.n).toBe("0");
    }));

  it("the account delete cascades on its own FK too (mutation: account_id `on delete restrict` -> FAILS 23503)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await insertUsage(c, call, acct);
      // Detach the call from the usage row's account path: the usage row's account FK alone must not block.
      const { rows: [other] } = await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) select agency_id, $2, 'CU Other' from accounts where id = $1 returning id",
        [acct, `${ORG}_o`]);
      await c.query("update phone_numbers set account_id = $2 where account_id = $1", [acct, other!.id]);
      await c.query("update calls set account_id = $2 where id = $1", [call, other!.id]);
      await c.query("delete from accounts where id = $1", [acct]);
      const { rows } = await c.query<{ n: string }>("select count(*)::text as n from call_usage where call_id = $1", [call]);
      expect(rows[0]!.n).toBe("0");
    }));

  it("the table and the cost column say what they are (mutation: drop either comment -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ t: string | null; k: string | null }>(
        `select obj_description('public.call_usage'::regclass, 'pg_class') as t,
                col_description('public.call_usage'::regclass,
                  (select attnum from pg_attribute where attrelid = 'public.call_usage'::regclass and attname = 'est_cost_microusd')::int) as k`);
      expect(r!.t).toMatch(/only the agency reads it/i);
      expect(r!.k).toMatch(/ESTIMATE/);
    }));

  it("the index the agency's per-account read uses is (account_id, created_at desc) (mutation: drop it -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ d: string }>(
        "select indexdef as d from pg_indexes where schemaname = 'public' and tablename = 'call_usage' and indexname = 'call_usage_by_account'");
      expect(rows.map((r) => r.d)).toEqual([
        "CREATE INDEX call_usage_by_account ON public.call_usage USING btree (account_id, created_at DESC)"]);
    }));
});

describe("0116: who reads, who writes", () => {
  const visible = async (c: Client, call: string) => {
    const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from call_usage where call_id = $1", [call]);
    return n!.n;
  };

  it("the agency reads it (mutation: drop policy call_usage_agency_read -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await insertUsage(c, call, acct);
      await actAs(c, AGENCY);
      expect(await visible(c, call)).toBe("1");
    }));

  it("the account's own Owner reads none of its own calls' usage: it is BIS's cost data (mutations: policy `using (true)`; `using (coalesce(app.is_agency(), false) or account_id = (select app.current_account_id()))` -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await insertUsage(c, call, acct);
      await actAsMember(c, acct, ORG, "owner");
      // The control: the same Owner DOES read the call itself, so a zero below is the policy, not a broken token.
      const { rows: [own] } = await c.query<{ n: string }>("select count(*)::text as n from calls where id = $1", [call]);
      expect(own!.n).toBe("1");
      expect(await visible(c, call)).toBe("0");
    }));

  it("a client token with no app_role and no membership reads nothing either (the NULL is_agency(); mutation: policy `using (app.is_agency() is not false)` -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await insertUsage(c, call, acct);
      await actAs(c, { org_id: ORG, sub: `u_cu_client_${RUN}` });
      expect(await visible(c, call)).toBe("0");
    }));

  it("the policy is SELECT only, PERMISSIVE, to authenticated, in the wrapped initplan form (mutations: `for all`; `to public` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ p: string; cmd: string; roles: string[]; perm: string; q: string }>(
        "select policyname as p, cmd, roles::text[] as roles, permissive as perm, qual as q from pg_policies where schemaname = 'public' and tablename = 'call_usage'");
      expect(rows).toEqual([{
        p: "call_usage_agency_read", cmd: "SELECT", roles: ["authenticated"], perm: "PERMISSIVE",
        q: "( SELECT COALESCE(app.is_agency(), false) AS \"coalesce\")",
      }]);
      const { rows: [rls] } = await c.query<{ on: boolean }>("select relrowsecurity as on from pg_class where oid = 'public.call_usage'::regclass");
      expect(rls!.on).toBe(true);
    }));

  it("anon holds nothing, authenticated holds SELECT only, service_role holds all four (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(`
        select r || ' ' || p || ' ' || has_table_privilege(r, 'public.call_usage', p)::text as x
          from (values ('anon'), ('authenticated'), ('service_role')) a(r)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) d(p)
         order by 1`);
      expect(rows.map((r) => r.x).filter((x) => x.endsWith(" true")).sort()).toEqual([
        "authenticated SELECT true",
        "service_role DELETE true", "service_role INSERT true", "service_role SELECT true", "service_role UPDATE true",
      ]);
      const { rows: cols } = await c.query<{ n: string }>(
        `select count(*)::text as n from pg_attribute a where a.attrelid = 'public.call_usage'::regclass and a.attnum > 0
           and (has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')
             or has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
             or has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT'))`);
      expect(cols[0]!.n).toBe("0");
    }));

  // The message, not only the code: an RLS refusal is ALSO 42501, so a code-only match could not fail on the grant
  // mutation (0086's lesson).
  it("an Owner's insert, and even the agency's, is refused by the grant itself (mutation: grant insert to authenticated -> RLS refuses with its own message -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await actAs(c, AGENCY);
      await expect(attempt(c, "insert into call_usage (call_id, account_id, model) values ($1, $2, 'gpt-realtime')", [call, acct]))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table call_usage" });
      await c.query("reset role");
      await actAsMember(c, acct, ORG, "owner");
      await expect(attempt(c, "insert into call_usage (call_id, account_id, model) values ($1, $2, 'gpt-realtime')", [call, acct]))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table call_usage" });
    }));

  it("service_role writes and reads it (mutation: revoke insert from service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const { acct, call } = await seed(c);
      await c.query("set local role service_role");
      await c.query("insert into call_usage (call_id, account_id, model, responses, output_audio_tokens, est_cost_microusd) values ($1, $2, 'gpt-realtime', 3, 1200, 54000)", [call, acct]);
      const { rows } = await c.query<{ r: number; o: number; e: string }>(
        "select responses as r, output_audio_tokens as o, est_cost_microusd::text as e from call_usage where call_id = $1", [call]);
      expect(rows).toEqual([{ r: 3, o: 1200, e: "54000" }]);
    }));
});
