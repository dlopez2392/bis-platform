import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";

/**
 * The TABLE side of migration 0042_assistants.sql: that the three tables
 * exist, that RLS is on, that the two policies are scoped to
 * `authenticated` (never PUBLIC — the defect 0017 exists to undo), and that
 * each role holds EXACTLY the privileges the migration grants and nothing
 * the default ACL left behind. `assistants.test.ts` covers the functions;
 * nothing here calls them.
 *
 * Signatures read from `./db` before writing, not recalled:
 *   withRollback(fn: (c: Client) => Promise<void>)   — ONE argument
 *   actAs(c: Client, claims: { org_id?: string; app_role?: string })
 *   actAsOwner(c: Client)                            — `reset role`
 * `actAsOwner` is deliberately NOT used here: `reset role` makes the
 * connection the table OWNER, which bypasses grants entirely and would pass
 * every assertion below for a reason unrelated to the property under test
 * (the point screened-calls-grants.test.ts makes in its own comment). An
 * agency session is `actAs(c, { app_role: "agency_admin" })`.
 *
 * ONE REFUSED STATEMENT PER `withRollback`: after the first refusal the
 * transaction is aborted (25P02) and every later statement fails with the
 * same error for the wrong reason. So each refusal below is the last
 * statement of its own test.
 */

/** Per-process suffix for every `clerk_org_id` this file writes.
 *  `accounts.clerk_org_id` is unique (0001_tenancy.sql) on the ONE Supabase
 *  project this suite shares with production. Everything here runs inside
 *  `withRollback` so nothing PERSISTS, but two concurrent runs would still
 *  block each other on the unique index for the lifetime of both open
 *  transactions. Shape copied from voice-web-sessions-grants.test.ts. */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_AS_${label}_${RUN}`;

/** A throwaway account on the raw (owner) connection `withRollback` hands
 *  every test. `client_access_enabled` is true because
 *  `app.current_account_id()` resolves nothing without it (0008), and every
 *  member assertion below depends on it resolving. */
async function seedAccount(c: Client, org: string): Promise<string> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture AS',true) returning id",
    [agency.id, org],
  );
  return account.id as string;
}

/** An assistant row, written as the owner so the test's own setup never
 *  depends on the grants it is about to assert. `public_id` is randomized:
 *  the column is unique project-wide. */
async function seedAssistant(c: Client, accountId: string): Promise<string> {
  const publicId = `t${Math.random().toString(36).slice(2, 12)}`;
  const { rows: [row] } = await c.query(
    "insert into assistants (account_id, public_id) values ($1,$2) returning id",
    [accountId, publicId],
  );
  return row.id as string;
}

/** Exactly the columns `AssistantPatch` can carry, plus `updated_at`, which
 *  the writer stamps (0018's reason). NOT on it, deliberately: `id`,
 *  `created_at`, `account_id` (the tenancy anchor) and `public_id` (the
 *  capability that IS the assistant's URL). */
const ASSISTANT_CLIENT_UPDATE_COLUMNS = [
  "allowed_origins",
  "enabled",
  "faq",
  "form_id",
  "greeting",
  "knowledge",
  "knowledge_urls",
  "locale_default",
  "name",
  "suggestions",
  "updated_at",
].sort();

describe("0042 assistants: the tables exist", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied. Precedent:
  // voice-web-sessions-grants.test.ts and call-proposals-grants.test.ts.
  it.each(["assistants", "assistant_sessions", "assistant_turns"])(
    "%s exists (guards every assertion below from vacuity)",
    (table) =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ oid: string | null }>(
          `select to_regclass($1)::text as oid`, [`public.${table}`],
        );
        expect(rows[0]!.oid?.replace(/^public\./, "")).toBe(table);
      }),
  );

  it("assistants carries every column the spec names, with the declared defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
        `select column_name, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'assistants'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        "account_id", "allowed_origins", "created_at", "enabled", "faq", "form_id",
        "greeting", "id", "knowledge", "knowledge_urls", "locale_default", "name",
        "public_id", "suggestions", "updated_at",
      ]);
      const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
      // `form_id` is the only nullable column: no form means no
      // `capture_lead` tool, which is a supported state, not an error.
      expect(byName.form_id!.is_nullable).toBe("YES");
      for (const col of ["account_id", "public_id", "enabled", "name", "knowledge",
        "knowledge_urls", "faq", "greeting", "suggestions", "locale_default",
        "allowed_origins", "created_at", "updated_at"]) {
        expect(byName[col]!.is_nullable, `${col} must be NOT NULL`).toBe("NO");
      }
      expect(byName.enabled!.column_default).toBe("true");
      expect(byName.name!.column_default).toContain("'Assistant'");
      expect(byName.locale_default!.column_default).toContain("'en'");
    }));

  it("assistant_sessions and assistant_turns carry every column the spec names", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public'
            and table_name in ('assistant_sessions','assistant_turns')
          order by table_name, column_name`,
      );
      const cols = (t: string) => rows.filter((r) => r.table_name === t).map((r) => r.column_name);
      expect(cols("assistant_sessions")).toEqual([
        "account_id", "assistant_id", "contact_id", "created_at", "id", "ip_hash",
        "locale", "page_url", "submission_id", "transcript", "turns", "updated_at",
      ]);
      expect(cols("assistant_turns")).toEqual([
        "account_id", "created_at", "id", "input_tokens", "ip_hash", "output_tokens", "session_id",
      ]);
    }));

  it("a locale outside ('en','es') is refused on both tables that carry one (mutation: drop either check -> FAILS)", () =>
    withRollback(async (c) => {
      const accountId = await seedAccount(c, orgId("LOCALE"));
      await expect(
        c.query(
          "insert into assistants (account_id, public_id, locale_default) values ($1,$2,'fr')",
          [accountId, `t${Math.random().toString(36).slice(2, 12)}`],
        ),
      ).rejects.toThrow(/locale_default/);
    }));

  it("a session locale outside ('en','es') is refused (mutation: drop the check -> FAILS)", () =>
    withRollback(async (c) => {
      const accountId = await seedAccount(c, orgId("SLOCALE"));
      const assistantId = await seedAssistant(c, accountId);
      await expect(
        c.query(
          "insert into assistant_sessions (assistant_id, account_id, ip_hash, locale) values ($1,$2,$3,'de')",
          [assistantId, accountId, "a".repeat(32)],
        ),
      ).rejects.toThrow(/locale/);
    }));

  it("one assistant per account is a UNIQUE constraint, not a convention (mutation: drop assistants_one_per_account -> FAILS)", () =>
    withRollback(async (c) => {
      const accountId = await seedAccount(c, orgId("ONEPER"));
      await seedAssistant(c, accountId);
      await expect(seedAssistant(c, accountId)).rejects.toMatchObject({ code: "23505" });
    }));
});

describe("0042 assistants: RLS and policy scope", () => {
  it("RLS is on for all three tables (mutation: drop any `enable row level security` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity from pg_class
          where oid in ('public.assistants'::regclass,
                        'public.assistant_sessions'::regclass,
                        'public.assistant_turns'::regclass)`,
      );
      // Sorted in JS, not by SQL: `order by relname` uses the database's
      // collation, which in en_US.UTF-8 ignores the underscore and would
      // put "assistants" BEFORE "assistant_sessions" — an assertion that
      // fails for a reason that has nothing to do with RLS.
      const byName = Object.fromEntries(rows.map((r) => [r.relname, r.relrowsecurity]));
      expect(byName).toEqual({
        assistants: true, assistant_sessions: true, assistant_turns: true,
      });
    }));

  it("both policies are scoped to authenticated, never PUBLIC (mutation: drop `to authenticated` from either -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ tablename: string; policyname: string; roles: string; cmd: string }>(
        `select tablename, policyname, roles::text, cmd from pg_policies
          where schemaname = 'public'
            and tablename in ('assistants','assistant_sessions','assistant_turns')`,
      );
      // Keyed, not ordered: `order by tablename` uses the database's
      // collation, which in en_US.UTF-8 ignores the underscore and would
      // sort "assistants" before "assistant_sessions" — an assertion that
      // would then fail for a reason that has nothing to do with policy
      // scope. `assistant_turns` is absent on purpose (next test).
      expect(Object.fromEntries(rows.map((r) => [r.tablename, [r.policyname, r.cmd]]))).toEqual({
        assistants: ["assistants_member_all", "ALL"],
        assistant_sessions: ["assistant_sessions_member_read", "SELECT"],
      });
      // pg_policies.roles is '{public}' for an unscoped policy — exactly
      // what 0016 shipped and 0017 had to correct.
      for (const row of rows) expect(row.roles).toBe("{authenticated}");
    }));

  it("assistant_turns has NO policy — deny-all is the policy (mutation: add one -> FAILS, because a policy implies a grant exists to serve)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ policies: string }>(
        `select (select count(*) from pg_policy p where p.polrelid = c.oid)::text as policies
           from pg_class c where c.oid = 'public.assistant_turns'::regclass`,
      );
      expect(rows[0]!.policies).toBe("0");
    }));

  it("a member reads its OWN assistant", () =>
    withRollback(async (c) => {
      const org = orgId("OWNREAD");
      const accountId = await seedAccount(c, org);
      const assistantId = await seedAssistant(c, accountId);
      await actAs(c, { org_id: org });
      const { rows } = await c.query("select id from assistants where id = $1", [assistantId]);
      expect(rows).toHaveLength(1);
    }));

  it("a member reads NONE of another account's assistant — zero rows, not an error (mutation: widen the using() clause -> FAILS)", () =>
    withRollback(async (c) => {
      const mineOrg = orgId("XREAD_MINE");
      const mine = await seedAccount(c, mineOrg);
      const theirs = await seedAccount(c, orgId("XREAD_THEIRS"));
      await seedAssistant(c, mine);
      const theirAssistant = await seedAssistant(c, theirs);
      await actAs(c, { org_id: mineOrg });
      const { rows } = await c.query("select id, account_id from assistants where id = $1", [theirAssistant]);
      expect(rows).toHaveLength(0);
    }));

  it("a member cannot INSERT an assistant into another account (mutation: widen the with check() clause -> FAILS)", () =>
    withRollback(async (c) => {
      const mineOrg = orgId("XWRITE_MINE");
      await seedAccount(c, mineOrg);
      const theirs = await seedAccount(c, orgId("XWRITE_THEIRS"));
      await actAs(c, { org_id: mineOrg });
      await expect(
        c.query("insert into assistants (account_id, public_id) values ($1,$2)",
          [theirs, `t${Math.random().toString(36).slice(2, 12)}`]),
      ).rejects.toThrow(/row-level security/);
    }));

  it("an agency admin sees assistants across accounts", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, orgId("AGENCY_A"));
      const b = await seedAccount(c, orgId("AGENCY_B"));
      await seedAssistant(c, a);
      await seedAssistant(c, b);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query(
        "select account_id from assistants where account_id in ($1,$2)", [a, b],
      );
      expect(rows.map((r: { account_id: string }) => r.account_id).sort()).toEqual([a, b].sort());
    }));

  it("a member reads its own sessions and none of another account's (mutation: widen assistant_sessions_member_read -> FAILS)", () =>
    withRollback(async (c) => {
      const mineOrg = orgId("SESSREAD");
      const mine = await seedAccount(c, mineOrg);
      const theirs = await seedAccount(c, orgId("SESSREAD_THEIRS"));
      const mineAssistant = await seedAssistant(c, mine);
      const theirAssistant = await seedAssistant(c, theirs);
      await c.query(
        `insert into assistant_sessions (assistant_id, account_id, ip_hash, locale)
           values ($1,$2,$3,'en'), ($4,$5,$6,'en')`,
        [mineAssistant, mine, "a".repeat(32), theirAssistant, theirs, "b".repeat(32)],
      );
      await actAs(c, { org_id: mineOrg });
      const { rows } = await c.query(
        "select account_id from assistant_sessions where account_id in ($1,$2)", [mine, theirs],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.account_id).toBe(mine);
    }));
});

describe("0042 assistants: grants are the boundary", () => {
  it("anon holds NOTHING on any of the three tables (mutation: drop a `revoke all … from anon` -> FAILS, because the default ACL grants all)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'anon'
            and table_name in ('assistants','assistant_sessions','assistant_turns')`,
      );
      expect(rows).toEqual([]);
    }));

  it("authenticated holds exactly SELECT + INSERT at table level on assistants (mutation: leave the table-level UPDATE in -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'assistants'
            and grantee = 'authenticated'
          order by privilege_type`,
      );
      expect(rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
    }));

  it("authenticated may UPDATE exactly the settings columns — never public_id or account_id (mutation: grant table-level update -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'assistants' and privilege_type = 'UPDATE'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(ASSISTANT_CLIENT_UPDATE_COLUMNS);
    }));

  it("authenticated holds SELECT and nothing else on assistant_sessions (mutation: grant insert/update -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'assistant_sessions'
            and grantee = 'authenticated'
          order by privilege_type`,
      );
      expect(rows.map((r) => r.privilege_type)).toEqual(["SELECT"]);
    }));

  it("no client role is granted anything on assistant_turns, and service_role holds the four verbs (mutation: grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'assistant_turns'
          order by grantee, privilege_type`,
      );
      // The owner (`postgres`) always carries every privilege and no
      // migration touches that; the claim worth pinning is that nothing
      // else but service_role appears.
      expect([...new Set(rows.map((r) => r.grantee))].sort()).toEqual(["postgres", "service_role"]);
      expect(rows.filter((r) => r.grantee === "service_role").map((r) => r.privilege_type))
        .toEqual(expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]));
    }));

  it("service_role holds the four verbs on assistants and assistant_sessions too", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'service_role'
            and table_name in ('assistants','assistant_sessions')`,
      );
      for (const table of ["assistants", "assistant_sessions"]) {
        const privileges = rows.filter((r) => r.table_name === table).map((r) => r.privilege_type);
        expect(privileges, `${table} service_role grants`).toEqual(
          expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]),
        );
      }
    }));

  it("a client cannot rewrite public_id — the capability that IS the assistant's URL (mutation: grant table-level update -> FAILS)", () =>
    withRollback(async (c) => {
      const org = orgId("PUBIDWRITE");
      const accountId = await seedAccount(c, org);
      await seedAssistant(c, accountId);
      await actAs(c, { org_id: org });
      // Permission denied at the COLUMN grant, before RLS is consulted at
      // all: this is a grant test, not a policy test.
      await expect(
        c.query("update assistants set public_id = 'stolenstolen' where account_id = $1", [accountId]),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client CAN save its own settings — the grant list is not accidentally empty (mutation: forget the update grant -> FAILS)", () =>
    withRollback(async (c) => {
      const org = orgId("SETTINGSWRITE");
      const accountId = await seedAccount(c, org);
      await seedAssistant(c, accountId);
      await actAs(c, { org_id: org });
      const { rowCount } = await c.query(
        "update assistants set name = 'Front Desk', enabled = false, updated_at = now() where account_id = $1",
        [accountId],
      );
      expect(rowCount).toBe(1);
    }));

  it("a client cannot INSERT a session — transcripts are written by the server alone", () =>
    withRollback(async (c) => {
      const org = orgId("SESSINSERT");
      const accountId = await seedAccount(c, org);
      const assistantId = await seedAssistant(c, accountId);
      await actAs(c, { org_id: org });
      await expect(
        c.query(
          `insert into assistant_sessions (assistant_id, account_id, ip_hash, locale)
             values ($1,$2,$3,'en')`,
          [assistantId, accountId, "c".repeat(32)],
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot UPDATE a session — a transcript is a record, not a draft", () =>
    withRollback(async (c) => {
      const org = orgId("SESSUPDATE");
      const accountId = await seedAccount(c, org);
      await actAs(c, { org_id: org });
      await expect(
        c.query("update assistant_sessions set transcript = '[]'::jsonb where account_id = $1", [accountId]),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot DELETE a session", () =>
    withRollback(async (c) => {
      const org = orgId("SESSDELETE");
      const accountId = await seedAccount(c, org);
      await actAs(c, { org_id: org });
      await expect(
        c.query("delete from assistant_sessions where account_id = $1", [accountId]),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot SELECT the turn ledger at all", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: orgId("TURNSELECT") });
      await expect(
        c.query("select * from assistant_turns"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("an agency admin cannot read the turn ledger either — it is service-role only", () =>
    withRollback(async (c) => {
      await actAs(c, { app_role: "agency_admin" });
      await expect(
        c.query("select * from assistant_turns"),
      ).rejects.toThrow(/permission denied/i);
    }));
});

describe("0042 assistants: teardown", () => {
  /**
   * WHY NONE OF THE THREE IS ON `ACCOUNT_OWNED_TABLES`. All three carry
   * `account_id … on delete cascade`, so the `accounts` delete at the end
   * of `deleteAccountCascade` carries them away — the same call 0036, 0039
   * and 0040 made, and the same reason account-teardown.ts's exclusion
   * doc-block gives. This test PROVES the rows are gone rather than
   * assuming it; a table added with the usual `restrict` and left off the
   * list surfaces much later, as a unique-constraint failure in an
   * unrelated suite.
   *
   * It also exercises the two `on delete set null` legs in passing:
   * `deleteAccountCascade` deletes `form_submissions`, `forms` and
   * `contacts` BEFORE the account, and an assistant pointing at a deleted
   * form (or a session pointing at a deleted submission) must not turn that
   * delete into a foreign-key violation — which is what the cleanup would
   * report, per table, if either FK were `restrict`.
   */
  it("all three tables ride the account's own cascade, so they need no line in the teardown list", async () => {
    let accountId = "";
    await withTestAccount(async (db, id) => {
      accountId = id;
      const { data: form, error: formErr } = await db.from("forms")
        .insert({ account_id: id, public_id: `t${Math.random().toString(36).slice(2, 12)}`, name: "Teardown Sink" })
        .select("id").single();
      expect(formErr, `form insert failed: ${formErr?.message}`).toBeNull();

      const { data: assistant, error: assistantErr } = await db.from("assistants")
        .insert({ account_id: id, public_id: `t${Math.random().toString(36).slice(2, 12)}`, form_id: form!.id })
        .select("id").single();
      expect(assistantErr, `assistant insert failed: ${assistantErr?.message}`).toBeNull();

      const { data: session, error: sessionErr } = await db.from("assistant_sessions")
        .insert({ assistant_id: assistant!.id, account_id: id, ip_hash: "d".repeat(32), locale: "en" })
        .select("id").single();
      expect(sessionErr, `session insert failed: ${sessionErr?.message}`).toBeNull();

      const { data: submission, error: submissionErr } = await db.from("form_submissions")
        .insert({ account_id: id, form_id: form!.id, answers: [] })
        .select("id").single();
      expect(submissionErr, `submission insert failed: ${submissionErr?.message}`).toBeNull();

      const { error: linkErr } = await db.from("assistant_sessions")
        .update({ submission_id: submission!.id }).eq("id", session!.id);
      expect(linkErr, `link failed: ${linkErr?.message}`).toBeNull();

      const { error: turnErr } = await db.from("assistant_turns")
        .insert({ session_id: session!.id, account_id: id, ip_hash: "d".repeat(32) });
      expect(turnErr, `turn insert failed: ${turnErr?.message}`).toBeNull();
    });

    // withTestAccount's finally has now run deleteAccountCascade, which
    // names none of these three tables.
    const db = serviceDb();
    for (const table of ["assistants", "assistant_sessions", "assistant_turns"]) {
      const { data, error } = await db.from(table).select("id").eq("account_id", accountId);
      expect(error, `leftover check failed on ${table}: ${error?.message}`).toBeNull();
      expect(data, `${table} left rows behind after teardown`).toEqual([]);
    }
  });
});
