import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sqlRefusals } from "./sql";

/**
 * The SQL files the CI project is built and compared with. None of them can
 * be executed here (no connection is made from this suite), so what is pinned
 * is what CAN go wrong without running them:
 *
 *   - bytes: ASCII only and no backslash, because a backslash is exactly what
 *     the MCP apply path mangled on 0048 (memory `bis-mcp-sql-escapes`), and
 *     the same files may yet be pasted into `execute_sql` against production;
 *   - mode: the parity reads pass ci:sql's read gate, the bootstrap does not
 *     (it must need --allow-write) and carries no transaction control;
 *   - content: the bootstrap reproduces production's `postgres`-owner default
 *     privileges row for row, and creates `app` before granting in it;
 *   - sync: the fingerprint's summary and detail forms share ONE item list.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../supabase/${rel}`, import.meta.url)), "utf8");

const FILES = [
  "bootstrap/ci-project.sql",
  "parity/fingerprint.sql",
  "parity/fingerprint-detail.sql",
  "parity/migration-history.sql",
];
const READS = FILES.filter((f) => f.startsWith("parity/"));

const oneLine = (s: string) => s.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

describe("CI SQL files: bytes", () => {
  it.each(FILES)("%s is ASCII only", (f) => {
    const bad = [...read(f)].map((ch, i) => [ch.charCodeAt(0), i] as const).filter(([code]) => code > 0x7e || (code < 0x20 && code !== 0x0a && code !== 0x0d));
    expect(bad).toEqual([]);
  });

  it.each(FILES)("%s has no backslash", (f) => {
    expect(read(f).includes(String.fromCharCode(0x5c))).toBe(false);
  });
});

describe("CI SQL files: mode", () => {
  it.each(READS)("%s passes ci:sql's read gate", (f) => {
    expect(sqlRefusals(read(f), { allowWrite: false })).toEqual([]);
  });

  it("the bootstrap is refused as a read", () => {
    expect(sqlRefusals(read("bootstrap/ci-project.sql"), { allowWrite: false }).length).toBeGreaterThan(0);
  });

  it("the bootstrap runs with --allow-write (no transaction control of its own)", () => {
    expect(sqlRefusals(read("bootstrap/ci-project.sql"), { allowWrite: true })).toEqual([]);
  });
});

describe("the bootstrap reproduces production's default privileges", () => {
  /**
   * Production's `postgres`-owner rows of pg_default_acl, read 2026-09-24
   * (.superpowers/sdd/prod-default-acl-2026-09-24.txt, plan step O2):
   *
   *   app     f {anon=X,authenticated=X,service_role=X}
   *   public  S {postgres=rwU,anon=rwU,authenticated=rwU,service_role=rwU}
   *   public  f {postgres=X,anon=X,authenticated=X,service_role=X}
   *   public  r {postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}
   *   storage S / f / r   the same three as public
   *
   * `all` is the whole set for each object type on Postgres 17 (both
   * projects): tables arwdDxtm (m = MAINTAIN, new in 17), sequences rwU,
   * functions X. The `app` row names no `postgres` grantee, and neither may
   * the statement, or the parity diff shows an extra ACL item.
   */
  const EXPECTED = [
    "alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;",
    "alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;",
    "alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;",
    "alter default privileges for role postgres in schema storage grant all on tables to postgres, anon, authenticated, service_role;",
    "alter default privileges for role postgres in schema storage grant all on sequences to postgres, anon, authenticated, service_role;",
    "alter default privileges for role postgres in schema storage grant all on functions to postgres, anon, authenticated, service_role;",
    "alter default privileges for role postgres in schema app grant all on functions to anon, authenticated, service_role;",
  ];
  const statements = () => oneLine(read("bootstrap/ci-project.sql")).split(";").map((s) => s.trim()).filter(Boolean).map((s) => `${s};`);

  it("carries exactly the seven postgres-owner rows, and no other default-privilege change", () => {
    expect(statements().filter((s) => s.startsWith("alter default privileges"))).toEqual(EXPECTED);
  });

  it("creates the app schema before granting in it (0001 creates it too, with if not exists)", () => {
    const all = statements();
    const create = all.indexOf("create schema if not exists app;");
    const firstAppGrant = all.findIndex((s) => s.includes("in schema app"));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(firstAppGrant).toBeGreaterThan(create);
  });

  it("leaves the platform-managed roles alone", () => {
    expect(oneLine(read("bootstrap/ci-project.sql"))).not.toMatch(/supabase_admin|supabase_auth_admin|for role (?!postgres)/);
  });

  it("creates the public brand-logos bucket the branding code and demo-seed test upload to", () => {
    expect(statements()).toContain(
      "insert into storage.buckets (id, name, public) values ('brand-logos', 'brand-logos', true) on conflict (id) do update set public = excluded.public;",
    );
  });
});

describe("the parity fingerprint", () => {
  /** Everything from `with items` up to the closing paren of the CTE. */
  const itemList = (sql: string) => {
    const start = sql.indexOf("with items(kind, key, def) as (");
    const end = sql.indexOf("\n)\n", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end);
  };

  it("summary and detail forms share one item list, byte for byte", () => {
    expect(itemList(read("parity/fingerprint-detail.sql"))).toBe(itemList(read("parity/fingerprint.sql")));
  });

  it("covers every kind the plan compares", () => {
    const kinds = [...itemList(read("parity/fingerprint.sql")).matchAll(/select '([a-z_()]+)'/g)].map((m) => m[1]).sort();
    expect(kinds).toEqual([
      "bucket", "column", "column_grant", "constraint", "default_acl", "enum", "event_trigger",
      "extension", "extension_version(info)", "function", "index", "policy", "publication",
      "relation", "schema_acl", "table_grant", "trigger",
    ]);
  });

  it("summary form ends in one digest per kind; detail form lists the rows", () => {
    expect(oneLine(read("parity/fingerprint.sql"))).toMatch(/\) select kind, count\(\*\) as n, md5\(string_agg\(key \|\| '=' \|\| coalesce\(def, ''\), chr\(10\) order by key, def\)\) as digest from items group by kind order by kind;$/);
    expect(oneLine(read("parity/fingerprint-detail.sql"))).toMatch(/\) select kind, key, def from items order by kind, key, def;$/);
  });
});
