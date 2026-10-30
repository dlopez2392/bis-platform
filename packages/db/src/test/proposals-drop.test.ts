import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";

/**
 * 0090 (item 8b-2, spec 4.6; plan Task 2): the bridge is gone. call_proposals, its two triggers (they
 * go with the table) and the three bridge functions are dropped; proposals and everything of its own
 * is untouched; no client write grant moves.
 *
 * RED BEFORE 0090, GREEN AFTER: on a database through 0089 the first case fails (the table and the
 * three functions still resolve). The second and third are green on both sides by design: they pin
 * that the drop takes nothing else with it, so they fail only if 0090 reaches past call_proposals.
 *
 * 0090's own self-check (every call_proposals row copied, every decided row's status equal) and its
 * one-transaction proof cannot be tested here: vitest runs after the drop. The implementer proves both
 * on a replica (plan Task 2), and the reviewer re-runs them.
 */

/** Positive controls in the same query: the lookups resolve a name that exists, so null means gone. */
async function bridgeLookups(c: Client) {
  const { rows } = await c.query(
    `select to_regclass('public.call_proposals')::text as call_proposals,
            to_regtype('public.call_proposals')::text as call_proposals_type,
            to_regprocedure('app.copy_call_proposals()')::text as copy_fn,
            to_regprocedure('app.mirror_call_proposal()')::text as mirror_fn,
            to_regprocedure('app.guard_call_proposal()')::text as guard_fn,
            to_regclass('public.proposals')::text as proposals,
            to_regprocedure('app.proposals_proposed_is_fixed()')::text as fixed_fn`);
  return rows[0];
}

describe("0090: the bridge is dropped (spec 4.6)", () => {
  it("call_proposals and the three bridge functions are gone, while proposals and its own trigger function resolve (mutation: leave out any one drop function -> FAILS)", () =>
    withRollback(async (c) => {
      expect(await bridgeLookups(c)).toEqual({
        call_proposals: null,
        call_proposals_type: null,
        copy_fn: null,
        mirror_fn: null,
        guard_fn: null,
        proposals: "proposals",
        fixed_fn: "app.proposals_proposed_is_fixed()",
      });
    }));

  it("no trigger, policy or function anywhere still names call_proposals (mutation: drop the table but keep a bridge function -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select 'function ' || n.nspname || '.' || p.proname as o from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.prosrc ilike '%call_proposal%'
         union all
         select 'trigger ' || t.tgname from pg_trigger t where t.tgname ilike '%call_proposal%'
         union all
         select 'policy ' || pol.polname from pg_policy pol where pol.polname ilike '%call_proposal%'
         order by 1`);
      expect(rows).toEqual([]);
    }));
});

describe("0090: proposals is untouched (spec 4.6)", () => {
  it("proposals keeps its own trigger (plus 0106's insert-only follow_merge), its two policies and its six indexes, by name and shape (mutation: drop index proposals_call_idx in 0090 -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: triggers } = await c.query(
        `select tgname, tgfoid::regprocedure::text as fn from pg_trigger
          where tgrelid = 'public.proposals'::regclass and not tgisinternal order by tgname`);
      // 0106 part B adds proposals_follow_merge (BEFORE INSERT only: a new suggestion naming a merged-away contact
      // lands on the kept one; the fixed-column trigger below still refuses every update).
      expect(triggers).toEqual([
        { tgname: "proposals_follow_merge", fn: "app.follow_merge()" },
        { tgname: "proposals_proposed_is_fixed", fn: "app.proposals_proposed_is_fixed()" },
      ]);

      const { rows: policies } = await c.query(
        `select policyname, permissive, cmd, roles::text as roles from pg_policies
          where schemaname = 'public' and tablename = 'proposals' order by policyname`);
      expect(policies).toEqual([
        { policyname: "proposals_member_read", permissive: "PERMISSIVE", cmd: "SELECT", roles: "{authenticated}" },
        { policyname: "proposals_technician_scope", permissive: "RESTRICTIVE", cmd: "SELECT", roles: "{authenticated}" },
      ]);

      const { rows: indexes } = await c.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname = 'public' and tablename = 'proposals' order by indexname`);
      expect(indexes.map((r) => r.indexname)).toEqual([
        "proposals_account_contact_idx", "proposals_account_pending_idx", "proposals_call_idx",
        "proposals_contact_decided_idx", "proposals_one_pending_per_call", "proposals_pkey",
      ]);
    }));

  // The faithfulness digest (plan 8b-1 "The replica kit"): every INSERT, UPDATE and DELETE anon or
  // authenticated holds on a public table. Its value after 0088 (and 0089, which adds a function only)
  // is the one below, read off bis-ci on 2026-10-19; call_proposals held no client write since 0053, so
  // dropping it leaves the value as it was. A LATER migration that changes the client write surface
  // updates this literal in the same commit as schema-grants-guard.test.ts's EXPECTED_WRITES.
  // 0097 (S-47d) adds one table-level client write, authenticated DELETE on closed_days (the column-level
  // grants on business_status and closed_days do not count here): 51 → 52, read off bis-ci after 0097.
  // 0106 (F-006) removes authenticated's table INSERT, UPDATE and DELETE on contact_duplicate_flags (column INSERT
  // stays, which this digest does not count): 52 → 49, read on a PG17 replica of 0001-0106; the orchestrator re-reads
  // it on bis-ci after apply.
  it("the client-write digest is unchanged (mutation: grant insert on public.proposals to authenticated in 0090 -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select count(*) || '|' || md5(string_agg(x, ',' order by x)) as digest from (
           select r || ' ' || c.relname || ' ' || p as x
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            cross join (values ('anon'), ('authenticated')) v(r)
            cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
            where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s`);
      expect(rows[0]!.digest).toBe("49|e0df0cc230da2dce6fa93b26b43e6d46");
    }));
});
