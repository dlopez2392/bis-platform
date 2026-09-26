import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { serviceDb } from "../service";

/**
 * Per-process suffix for every `clerk_org_id` this file writes.
 * `accounts.clerk_org_id` is `unique` (`0001_tenancy.sql:24`) on the ONE
 * Supabase project this suite shares with production. Every id below used
 * to be a fixed literal (`org_CP_RLS_A`, `org_CP_INSERT`, `org_CP_KIND`,
 * `org_CP_STATUS`) — everything here runs inside `withRollback` so nothing
 * PERSISTS, but two concurrent runs would still BLOCK each other on the
 * unique index for the lifetime of both open transactions.
 * `fixtures.ts:41-50,177-179` (`testPhoneNumber`, `testBlueprintName`) is
 * this repo's own doctrine that a fixed literal in a shared-project fixture
 * is the bug, not a convenience; shape copied from `testBlueprintName`'s
 * `BLUEPRINT_RUN`, one random suffix computed once per process.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_CP_${label}_${RUN}`;

/**
 * A throwaway account + phone number + call, inserted with the raw (owner)
 * connection `withRollback` hands every test — the same shape
 * `automations-grants.test.ts`'s `seedTwoAccounts` uses, extended with the
 * `phone_numbers`/`calls` rows a `call_proposals` row must point at
 * (`call_id` is `not null`).
 */
async function seedAccountWithCall(c: any, orgId: string) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture CP',true) returning id",
    [agency.id, orgId],
  );
  const { rows: [phone] } = await c.query(
    "insert into phone_numbers (account_id, e164) values ($1,$2) returning id",
    [account.id, testPhoneNumber()],
  );
  const { rows: [call] } = await c.query(
    "insert into calls (account_id, phone_number_id) values ($1,$2) returning id",
    [account.id, phone.id],
  );
  return { accountId: account.id as string, callId: call.id as string };
}

/** `seedAccountWithCall`, plus ONE pending proposal on that call — written
 *  with the owner connection so the insert itself never depends on grants
 *  or RLS. Used by both the "see" trio below and the "act" block. */
async function seedAccountWithProposal(c: any, org: string) {
  const { accountId, callId } = await seedAccountWithCall(c, org);
  const { rows: [proposal] } = await c.query(
    `insert into public.call_proposals (account_id, call_id, kind, payload, evidence)
       values ($1, $2, 'task', '{}'::jsonb, 'the caller asked to be called back tomorrow')
       returning id`,
    [accountId, callId],
  );
  return { accountId, callId, proposalId: proposal.id as string };
}

/** Two real accounts, each with its own call, and ONE pending proposal on
 *  account A's call. Account A's and B's `clerk_org_id`s are `orgId("RLS_A")`
 *  and `orgId("RLS_B")` — per-process, not fixed literals (see `orgId`
 *  above). */
async function seedTwoAccountsWithProposal(c: any) {
  const a = await seedAccountWithProposal(c, orgId("RLS_A"));
  const b = await seedAccountWithCall(c, orgId("RLS_B"));
  return { a, b, proposalId: a.proposalId };
}

describe("call_proposals grants", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied.
  it("the table exists (guards every assertion below from vacuity)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.call_proposals')::text as oid`,
      );
      // Schema-qualified or not depending on the connection's search_path,
      // which this suite does not control (precedent:
      // alert-phone-verification-grants.test.ts:174-176).
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe("call_proposals");
    }));

  it("anon holds NO privileges at all (mutation: drop the `revoke all ... from anon` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'call_proposals' and grantee = 'anon'`,
      );
      expect(rows).toEqual([]);
    }));

  // EXACT row set, not a containment check: `toContain`/`not.toContain`
  // leaves TRUNCATE, REFERENCES and TRIGGER unasserted, and this project's
  // default ACL hands TRUNCATE to `authenticated` on every new table
  // (`pg_default_acl`). Live-verified before writing this: `authenticated`'s
  // full row set on `call_proposals` is exactly one row today
  // (`select grantee, privilege_type from information_schema.role_table_grants
  // where table_schema='public' and table_name='call_proposals'` against
  // tlbkbmlrfafquucsmsmm, 2026-09-18). Falsifiability proved in a rolled-back
  // transaction, not by vitest: running `grant insert on public.call_proposals
  // to authenticated` there and re-running this exact query returns BOTH
  // `INSERT` and `SELECT`, which fails this `toEqual` — proved live, then
  // rolled back, so nothing was ever committed.
  it("authenticated holds EXACTLY select at the table level (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'call_proposals' and grantee = 'authenticated'
           order by privilege_type`,
      );
      expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
    }));

  it("authenticated's UPDATE is column-scoped to the decision columns (mutation: grant update on the whole table -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'call_proposals'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'`,
      );
      const cols = rows.map((r) => r.column_name).sort();
      expect(cols).toEqual(["decided_at", "decided_by", "status"]);
    }));

  // A superset, not an exact set, and deliberately so — same reasoning as
  // alert-phone-verification-grants.test.ts:193-206: 0040's own `revoke all
  // ... from anon, authenticated` only touches those two roles, so
  // `service_role` keeps the FULL default-ACL set (all seven privileges,
  // live-verified). Pinning it to exactly those seven would pin Supabase's
  // default ACL rather than this migration's intent; what the migration DOES
  // decide, and what this line catches, is that service_role keeps at least
  // the four the generator/decision flow needs. Falsifiability proved in a
  // rolled-back transaction: `revoke insert on public.call_proposals from
  // service_role` there drops INSERT from the live row set, which fails the
  // `arrayContaining` below — proved live, then rolled back.
  it("service_role holds at least select/insert/update/delete (mutation: revoke insert from service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'call_proposals' and grantee = 'service_role'`,
      );
      expect(rows.map((r) => r.privilege_type)).toEqual(
        expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]),
      );
    }));

  // Finding 4: every assertion above filters by `grantee`, on the table
  // whose grants block IS the security boundary — a grant to PUBLIC would be
  // invisible to all three. This one assertion covers the WHOLE
  // `(grantee, privilege_type)` set (`grantee <> 'postgres'`, which also
  // catches a literal `PUBLIC` row), subsuming the anon and authenticated
  // cases above. Live-read against tlbkbmlrfafquucsmsmm, 2026-09-18: exactly
  // these eight rows. Falsifiability proved WITHOUT DDL, by retargeting this
  // exact query at `contact_duplicate_flags` (`0033_contact_dedupe_keys.sql`)
  // instead — that table carries the full default ACL for anon,
  // authenticated AND service_role (7 privileges apiece, live-verified
  // 2026-09-18), so the SAME `toEqual` against the SAME expected array fails
  // there by name; switching the literal back to `call_proposals` is what
  // makes it pass.
  it("the table's full grant set, across every role including PUBLIC, is exactly this (mutation: retarget the query at contact_duplicate_flags -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'call_proposals' and grantee <> 'postgres'
           order by grantee, privilege_type`,
      );
      expect(rows).toEqual([
        { grantee: "authenticated", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "DELETE" },
        { grantee: "service_role", privilege_type: "INSERT" },
        { grantee: "service_role", privilege_type: "REFERENCES" },
        { grantee: "service_role", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "TRIGGER" },
        { grantee: "service_role", privilege_type: "TRUNCATE" },
        { grantee: "service_role", privilege_type: "UPDATE" },
      ]);
    }));

  // ONE REFUSED STATEMENT PER withRollback. After a rejection the
  // transaction is aborted (25P02) and every later statement in this block
  // would test the abort, not the property — so this gets its own block.
  //
  // account_id/call_id are a REAL seeded account and a REAL call under it,
  // not gen_random_uuid()'s fiction. With a real account_id, RLS's WITH
  // CHECK (`account_id = app.current_account_id()`) would PASS if the
  // INSERT grant existed, so the only thing left standing between this
  // client and a written row is the grant — proved live in a rolled-back
  // transaction (never committed): with today's grants, this insert fails
  // 42501 "permission denied"; running `grant insert on public.call_proposals
  // to authenticated` first and retrying the SAME insert (same account,
  // same call, same org claim) SUCCEEDS. The old fixture (gen_random_uuid()
  // ids, no seeded account) could not tell that story: `current_account_id()`
  // resolves NULL for an org with no account row, so even WITH the grant that
  // version's insert would still fail — on RLS instead of on the grant — and
  // the test would have measured an error STRING, not the grant.
  it("a client cannot INSERT a proposal, even for its own real account and call (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId } = await seedAccountWithCall(c, orgId("INSERT"));
      await actAs(c, { org_id: orgId("INSERT") });
      await expect(
        c.query(
          `insert into public.call_proposals (account_id, call_id, kind, payload, evidence)
             values ($1, $2, 'task', '{}'::jsonb, 'the caller asked for a callback')`,
          [accountId, callId],
        ),
      ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied/i) });
    }));

  // 0039's precedent, applied to the two value lists this table actually has.
  // Falsifiability proved in a rolled-back transaction (never committed):
  // `alter table public.call_proposals drop constraint
  // call_proposals_kind_check` there, then the SAME out-of-list insert
  // SUCCEEDS — proof the check, not something else, was the barrier.
  it("refuses a kind outside the three — proof the list is a list, not a hole (mutation: drop call_proposals_kind_check -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId } = await seedAccountWithCall(c, orgId("KIND"));
      await expect(
        c.query(
          `insert into public.call_proposals (account_id, call_id, kind, payload, evidence)
             values ($1, $2, 'made-up', '{}'::jsonb, 'the caller asked for a callback')`,
          [accountId, callId],
        ),
      ).rejects.toThrow(/call_proposals_kind_check/);
    }));

  // Falsifiability proved the same way as the kind check, in its own rolled-
  // back transaction: dropping `call_proposals_status_check` there lets the
  // same out-of-list `status` insert succeed.
  it("refuses a status outside the three — proof the list is a list, not a hole (mutation: drop call_proposals_status_check -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId } = await seedAccountWithCall(c, orgId("STATUS"));
      await expect(
        c.query(
          `insert into public.call_proposals (account_id, call_id, kind, status, payload, evidence)
             values ($1, $2, 'task', 'archived', '{}'::jsonb, 'the caller asked for a callback')`,
          [accountId, callId],
        ),
      ).rejects.toThrow(/call_proposals_status_check/);
    }));

  // Finding 2: the third CHECK this migration ships (`kind` and `status`
  // above already have theirs). Same shape, same falsifiability proof:
  // dropping `call_proposals_evidence_nonempty` in a rolled-back transaction
  // lets the same all-whitespace insert succeed. `btrim` strips only ASCII
  // whitespace (unlike the `0033`/`0034` `trim()` divergence this table has
  // no TypeScript twin of), but three literal spaces are ASCII on both
  // sides, so this is not that class of bug.
  it("refuses evidence that is only whitespace — proof the constraint reads meaning, not presence (mutation: drop call_proposals_evidence_nonempty -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId } = await seedAccountWithCall(c, orgId("EVIDENCE"));
      await expect(
        c.query(
          `insert into public.call_proposals (account_id, call_id, kind, payload, evidence)
             values ($1, $2, 'task', '{}'::jsonb, '   ')`,
          [accountId, callId],
        ),
      ).rejects.toThrow(/call_proposals_evidence_nonempty/);
    }));

  // The spec's own test list: "A client and the agency both see and can act
  // on a proposal (RLS, live-proof)." Shape: automations-grants.test.ts:46-54
  // (client reads its own row) and :78-85 (agency reads every row). The third
  // case — a DIFFERENT client seeing nothing — is the one that matters, per
  // the brief: a missed account scope must degrade to zero rows, never
  // another tenant's data.
  it("the client of the owning account sees its own proposal", () =>
    withRollback(async (c) => {
      const { proposalId } = await seedTwoAccountsWithProposal(c);
      await actAs(c, { org_id: orgId("RLS_A") });
      const { rows } = await c.query("select id from call_proposals where id = $1", [proposalId]);
      expect(rows.map((r: any) => r.id)).toEqual([proposalId]);
    }));

  it("the agency sees the same proposal", () =>
    withRollback(async (c) => {
      const { proposalId } = await seedTwoAccountsWithProposal(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select id from call_proposals where id = $1", [proposalId]);
      expect(rows.map((r: any) => r.id)).toEqual([proposalId]);
    }));

  it("the client of a DIFFERENT account does not see it — zero rows, not an error", () =>
    withRollback(async (c) => {
      const { proposalId } = await seedTwoAccountsWithProposal(c);
      await actAs(c, { org_id: orgId("RLS_B") });
      const { rows } = await c.query("select id from call_proposals where id = $1", [proposalId]);
      expect(rows).toEqual([]);
    }));

  // Finding 1: the "see" trio above proves half the spec line — "A client
  // and the agency both see AND CAN ACT ON a proposal (RLS, live-proof)."
  // Every later task's tests run through `withTestAccount`, whose db handle
  // is `serviceDb()` — RLS AND grants bypassed — so nothing else in this
  // repo will ever exercise the column-level UPDATE grant that 0040's own
  // comment calls this table's actual security boundary. This block runs as
  // the `authenticated` role via `withRollback` + `actAs`, the only way to
  // reach that boundary at all.
  describe("acting on a proposal (the grant this table's RLS policy alone cannot enforce)", () => {
    // The one that matters most, per the brief: the only assertion that
    // would catch a grant tightened into breaking the real accept path.
    // Falsifiable WITHOUT touching the grant: swap `proposalId` for a
    // freshly generated uuid and the same query returns 0 rows, failing
    // `toBe(1)` — proved by literally making that edit, running this test
    // by name, watching it fail on `expect(received).toBe(1)  Expected: 1
    // Received: 0`, then reverting.
    it("the owning client can accept a proposal — updating the decision columns reaches 1 row", () =>
      withRollback(async (c) => {
        const org = orgId("ACT_ACCEPT");
        const { proposalId } = await seedAccountWithProposal(c, org);
        await actAs(c, { org_id: org });
        const res = await c.query(
          `update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_test'
             where id = $1`,
          [proposalId],
        );
        expect(res.rowCount).toBe(1);
      }));

    // The one that proves the column list is load-bearing, not decorative.
    // `payload` is deliberately absent from 0040's `grant update (...)`
    // list, so a client rewriting it before "accepting" its own edit — the
    // exact laundering the migration's comment names — must be refused at
    // the grant, before RLS is even consulted. Live-proved in a rolled-back
    // transaction against tlbkbmlrfafquucsmsmm, never committed: with
    // today's grants this UPDATE fails 42501 "permission denied for table
    // call_proposals"; resetting role to owner, running `grant update on
    // public.call_proposals to authenticated`, then retrying the identical
    // statement as the SAME `authenticated`/org claim SUCCEEDS (1 row) —
    // proof the column list, not something else, is the barrier.
    it("the owning client's UPDATE of payload is refused — the column grant is the boundary, not RLS (mutation: grant update on the whole table -> FAILS)", () =>
      withRollback(async (c) => {
        const org = orgId("ACT_PAYLOAD");
        const { proposalId } = await seedAccountWithProposal(c, org);
        await actAs(c, { org_id: org });
        await expect(
          c.query(`update call_proposals set payload = '{"x":1}'::jsonb where id = $1`, [proposalId]),
        ).rejects.toMatchObject({
          code: "42501",
          message: expect.stringMatching(/permission denied for table call_proposals/i),
        });
      }));

    // The agency half of the spec line. Falsifiable the same way as the
    // client-accept test above: swap `proposalId` for a fresh uuid, watch
    // `rowCount` come back 0 instead of 1.
    it("the agency can act on any account's proposal — updating the decision columns reaches 1 row", () =>
      withRollback(async (c) => {
        const { proposalId } = await seedAccountWithProposal(c, orgId("ACT_AGENCY"));
        await actAs(c, { app_role: "agency_admin" });
        const res = await c.query(
          `update call_proposals set status = 'dismissed', decided_at = now(), decided_by = 'agency_user'
             where id = $1`,
          [proposalId],
        );
        expect(res.rowCount).toBe(1);
      }));

    // RLS scoping on WRITE, not just read: a different client HAS the same
    // column grant (it is table-wide, not per-account), so the only thing
    // stopping it is the policy's `account_id = app.current_account_id()`.
    // A zero-row UPDATE returns no error — asserted as a row count, not a
    // rejection. Falsifiable: swap the `actAs` claim from the stranger's org
    // to the owner's org and `rowCount` becomes 1, failing `toBe(0)` —
    // proved by literally making that edit, running this test by name,
    // watching it fail, then reverting.
    it("a DIFFERENT client's UPDATE reaches zero rows, not an error — RLS scoping holds on write too", () =>
      withRollback(async (c) => {
        const ownerOrg = orgId("ACT_OTHER_OWNER");
        const strangerOrg = orgId("ACT_OTHER_STRANGER");
        const { proposalId } = await seedAccountWithProposal(c, ownerOrg);
        await seedAccountWithCall(c, strangerOrg);
        await actAs(c, { org_id: strangerOrg });
        const res = await c.query(
          `update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_test'
             where id = $1`,
          [proposalId],
        );
        expect(res.rowCount).toBe(0);
      }));

    // No client holds DELETE at all — 0040 grants it only to service_role.
    // Live-proved in a rolled-back transaction, never committed: with
    // today's grants this fails 42501 "permission denied for table
    // call_proposals"; resetting role, running `grant delete on public.
    // call_proposals to authenticated`, then retrying the identical
    // statement as the SAME org claim SUCCEEDS (1 row deleted) — proof the
    // absence of the grant, not RLS, is what refuses it.
    it("any client's DELETE is refused outright (mutation: grant delete on the table to authenticated -> FAILS)", () =>
      withRollback(async (c) => {
        const org = orgId("ACT_DELETE");
        const { proposalId } = await seedAccountWithProposal(c, org);
        await actAs(c, { org_id: org });
        await expect(
          c.query(`delete from call_proposals where id = $1`, [proposalId]),
        ).rejects.toMatchObject({
          code: "42501",
          message: expect.stringMatching(/permission denied for table call_proposals/i),
        });
      }));
  });

  // Shape: alert-phone-verification-grants.test.ts:311-328. `call_proposals`
  // stays OFF ACCOUNT_OWNED_TABLES (account-teardown.ts's exclusion
  // doc-block) — not because `account_id`'s own cascade fires here (it never
  // gets the chance to: `calls` is deleted first, on ACCOUNT_OWNED_TABLES,
  // and `call_id`'s `on delete cascade` removes this row at that point), but
  // because by the time `accounts` itself is deleted the row is already
  // gone. Either FK's cascade alone would produce the same observable
  // result, which is exactly why this test proves the row is gone rather
  // than asserting which FK did it.
  it("is carried off when its call goes, so it needs no line in the teardown list", async () => {
    let accountId = "";
    await withTestAccount(async (db, id) => {
      accountId = id;
      const { data: phoneNumber, error: phoneErr } = await db
        .from("phone_numbers")
        .insert({ account_id: id, e164: testPhoneNumber() })
        .select("id")
        .single();
      expect(phoneErr, `phone insert failed: ${phoneErr?.message}`).toBeNull();

      const { data: call, error: callErr } = await db
        .from("calls")
        .insert({ account_id: id, phone_number_id: phoneNumber!.id })
        .select("id")
        .single();
      expect(callErr, `call insert failed: ${callErr?.message}`).toBeNull();

      const { error: proposalErr } = await db.from("call_proposals").insert({
        account_id: id,
        call_id: call!.id,
        kind: "task",
        payload: {},
        evidence: "the caller asked to be called back tomorrow",
      });
      expect(proposalErr, `proposal insert failed: ${proposalErr?.message}`).toBeNull();
    });
    // withTestAccount's finally has now run deleteAccountCascade, which does
    // NOT name call_proposals. `calls` IS on that list and is deleted before
    // `accounts`, so `call_id`'s cascade (not `account_id`'s) is what
    // actually removes this row during a real teardown. This assertion is
    // what actually proves the row is gone, regardless of which FK did it.
    const { data, error } = await serviceDb()
      .from("call_proposals")
      .select("id")
      .eq("account_id", accountId);
    expect(error, `leftover check failed: ${error?.message}`).toBeNull();
    expect(data).toEqual([]);
  });
});
