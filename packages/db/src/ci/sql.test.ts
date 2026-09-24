import { describe, it, expect } from "vitest";
import { planCiSql, sqlRefusals } from "./sql";
import { PRODUCTION_SUPABASE_REF } from "./target";

/**
 * `ci:sql <file> [--allow-write]` runs one SQL file on the CI project through
 * `pg`, because the Supabase MCP connector cannot reach the CI project's org.
 * It replaces the plan's O4/O5/O8 `execute_sql` calls: the parity fingerprint
 * (read) and the bootstrap (write).
 *
 * Two layers, and these tests cover the first. `sqlRefusals` is a lexical
 * gate that refuses, BEFORE connecting, anything that is not plainly a read
 * unless `--allow-write` is passed. The second layer is the database's own:
 * a read runs inside `begin read only`, so a write the lexer misses is still
 * refused by Postgres. The lexer exists so the operator gets a clear refusal
 * naming the statement instead of a server error, and so transaction control
 * that would END the read-only transaction early is caught before it runs.
 */
const CI_REF = "cicicicicicicicicici";
const PROD = PRODUCTION_SUPABASE_REF;
const ciEnv = {
  BIS_CI_SUPABASE_REF: CI_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${CI_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres.${CI_REF}:Secretpass123@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
};
const pkg = "/repo/packages/db";

describe("planCiSql: the target", () => {
  it("refuses the production ref", () => {
    expect(() => planCiSql({
      BIS_CI_SUPABASE_REF: PROD,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
      SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    }, ["q.sql"], { cwd: pkg, packageDir: pkg })).toThrow(/BIS_CI_SUPABASE_REF is production's ref/);
  });

  it("refuses production's API URL", () => {
    expect(() => planCiSql({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` },
      ["q.sql"], { cwd: pkg, packageDir: pkg })).toThrow(/NEXT_PUBLIC_SUPABASE_URL points at production/);
  });

  it("refuses production's DB URL", () => {
    expect(() => planCiSql({
      ...ciEnv,
      SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    }, ["q.sql"], { cwd: pkg, packageDir: pkg })).toThrow(/SUPABASE_DB_URL points at production/);
  });

  it("refuses an unset CI ref", () => {
    expect(() => planCiSql({ ...ciEnv, BIS_CI_SUPABASE_REF: undefined }, ["q.sql"], { cwd: pkg, packageDir: pkg }))
      .toThrow(/BIS_CI_SUPABASE_REF is not set/);
  });
});

describe("planCiSql: the arguments", () => {
  const plan = (argv: string[]) => planCiSql(ciEnv, argv, { cwd: pkg, packageDir: pkg });

  it("refuses no file", () => {
    expect(() => plan([])).toThrow(/ci:sql needs exactly one \.sql file/);
  });

  it("refuses two files", () => {
    expect(() => plan(["a.sql", "b.sql"])).toThrow(/ci:sql needs exactly one \.sql file/);
  });

  it("refuses a file that is not .sql", () => {
    expect(() => plan(["notes.txt"])).toThrow(/ci:sql needs exactly one \.sql file/);
  });

  it("refuses an unknown flag", () => {
    expect(() => plan(["q.sql", "--force"])).toThrow(/refusing argument "--force"/);
  });

  it("does not echo arguments it refuses (one may be a URL with a password)", () => {
    const url = "postgresql://postgres.x:Secretpass123@h:5432/postgres";
    for (const argv of [[url], ["a.sql", url], [`--db-url=${url}`, "q.sql"]]) {
      let message = "";
      try { plan(argv); } catch (e) { message = (e as Error).message; }
      expect(message).not.toBe("");
      expect(message).not.toContain("Secretpass123");
    }
  });

  it("refuses a migration file, which only db:push:ci may apply", () => {
    expect(() => plan(["supabase/migrations/0050_same_account_fks.sql", "--allow-write"]))
      .toThrow(/is a migration: apply it with db:push:ci/);
  });

  it("refuses a migration file reached through ..", () => {
    expect(() => plan(["supabase/parity/../migrations/0001_tenancy.sql"]))
      .toThrow(/is a migration: apply it with db:push:ci/);
  });

  it("reads by default, resolving the file against the working directory", () => {
    const p = plan(["supabase/parity/fingerprint.sql"]);
    expect(p.allowWrite).toBe(false);
    expect(p.file.replace(/\\/g, "/")).toMatch(/\/repo\/packages\/db\/supabase\/parity\/fingerprint\.sql$/);
    expect(p.summary).toContain("read only");
    expect(p.summary).not.toContain("Secretpass123");
  });

  it("writes only with --allow-write, in either position", () => {
    expect(plan(["--allow-write", "supabase/bootstrap/ci-project.sql"]).allowWrite).toBe(true);
    const p = plan(["supabase/bootstrap/ci-project.sql", "--allow-write"]);
    expect(p.allowWrite).toBe(true);
    expect(p.summary).toContain("WRITE");
  });
});

describe("sqlRefusals: read mode", () => {
  const refused = (sql: string) => sqlRefusals(sql, { allowWrite: false });

  it("passes a plain select", () => {
    expect(refused("select 1;")).toEqual([]);
  });

  it("passes a with-query and a second statement", () => {
    expect(refused("with a as (select 1 as x) select x from a;\nselect 2;")).toEqual([]);
  });

  it("refuses an empty file", () => {
    expect(refused("-- nothing here\n")).toEqual(["the file has no statements"]);
  });

  it.each([
    ["insert", "insert into public.t values (1)"],
    ["update", "update public.t set x = 1"],
    ["delete", "delete from public.t"],
    ["merge", "merge into public.t using s on true when matched then do nothing"],
    ["truncate", "truncate public.t"],
    ["create", "create table public.t (x int)"],
    ["alter", "alter default privileges for role postgres grant all on tables to anon"],
    ["drop", "drop table public.t"],
    ["grant", "grant select on public.t to anon"],
    ["revoke", "revoke select on public.t from anon"],
    ["copy", "copy public.t to stdout"],
    ["do", "do $$ begin perform 1; end $$"],
    ["set", "set transaction read write"],
    ["call", "call public.p()"],
  ])("refuses a statement that starts with %s", (word, sql) => {
    expect(refused(sql)).toEqual([`statement 1 starts with "${word}", which is not a read`]);
  });

  it("refuses a data-modifying CTE", () => {
    expect(refused("with gone as (delete from public.t returning *) select * from gone"))
      .toEqual(['statement 1 uses "delete", which a read may not use']);
  });

  it("refuses select ... into, which creates a table", () => {
    expect(refused("select * into public.copy from public.t"))
      .toEqual(['statement 1 uses "into", which a read may not use']);
  });

  it("refuses nextval, which advances a sequence", () => {
    expect(refused("select nextval('public.s')")).toEqual(['statement 1 uses "nextval", which a read may not use']);
  });

  it("refuses set_config, which could switch the transaction to read-write", () => {
    expect(refused("select set_config('transaction_read_only', 'off', true)"))
      .toEqual(['statement 1 uses "set_config", which a read may not use']);
  });

  it("refuses select ... for update, which takes row locks", () => {
    expect(refused("select * from public.t for update"))
      .toEqual(['statement 1 uses "update", which a read may not use']);
  });

  it("refuses a server-file read", () => {
    expect(refused("select pg_read_file('/etc/passwd')"))
      .toEqual(['statement 1 uses "pg_read_file", which a read may not use']);
  });

  it("names the right statement when the write is not first", () => {
    expect(refused("select 1; select 2; delete from public.t;"))
      .toEqual(['statement 3 starts with "delete", which is not a read']);
  });

  it("does not refuse a write word inside a string literal", () => {
    expect(refused("select 'delete' as kind, 'it''s an update' as note")).toEqual([]);
  });

  it("does not refuse a write word inside a comment", () => {
    expect(refused("-- delete everything\n/* update /* nested insert */ drop */ select 1")).toEqual([]);
  });

  it("does not refuse a write word as a quoted identifier", () => {
    expect(refused('select 1 as "delete"')).toEqual([]);
  });

  it("does not refuse a write word inside a dollar-quoted string", () => {
    expect(refused("select $tag$insert into t$tag$ as body")).toEqual([]);
  });

  it("does not refuse an identifier that merely contains a write word", () => {
    expect(refused("select is_updatable, grantee, privilege_type from information_schema.tables")).toEqual([]);
  });

  it("does not split on a semicolon inside a string", () => {
    expect(refused("select 'a; delete from t' as x")).toEqual([]);
  });

  it("does not end an E'' string at a backslash-escaped quote", () => {
    // Postgres reads E'it\'s; delete from t' as ONE literal. A lexer that
    // ignored the escape would end it at \' and see a second statement.
    expect(refused("select E'it\\'s; delete from t' as x")).toEqual([]);
  });

  it("does not treat a backslash as an escape in a standard string", () => {
    // standard_conforming_strings: in '...\' the backslash is literal and the
    // quote closes the string, so what follows IS code and IS refused.
    expect(refused("select 'dir\\'; delete from public.t"))
      .toEqual(['statement 2 starts with "delete", which is not a read']);
  });
});

describe("sqlRefusals: transaction control is refused in BOTH modes", () => {
  for (const allowWrite of [false, true]) {
    it.each(["begin", "commit", "rollback", "end", "abort", "start transaction"])(
      `allowWrite=${allowWrite}: refuses %s`,
      (stmt) => {
        const word = stmt.split(" ")[0];
        expect(sqlRefusals(`select 1; ${stmt};`, { allowWrite }))
          .toEqual([`statement 2 is transaction control ("${word}"); ci:sql owns the transaction`]);
      },
    );
  }
});

describe("sqlRefusals: write mode", () => {
  it("passes writes when --allow-write is given", () => {
    expect(sqlRefusals(
      "create schema if not exists app;\nalter default privileges for role postgres in schema app grant all on functions to anon;\ninsert into storage.buckets (id, name, public) values ('b', 'b', true);",
      { allowWrite: true },
    )).toEqual([]);
  });
});
