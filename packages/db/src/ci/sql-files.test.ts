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

  /**
   * Production's row, read 2026-09-24 13:42Z (orchestrator): public = true,
   * file_size_limit = 524288, allowed_mime_types = {image/png,image/jpeg,
   * image/webp}. The MIME array's ORDER is part of what the fingerprint's
   * bucket kind compares (`allowed_mime_types::text`), so it is pinned too.
   */
  it("creates the brand-logos bucket exactly as production has it, and converges a re-run onto it", () => {
    expect(statements()).toContain(
      "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) " +
      "values ('brand-logos', 'brand-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp']) " +
      "on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, " +
      "allowed_mime_types = excluded.allowed_mime_types;",
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
    expect(oneLine(read("parity/fingerprint.sql"))).toMatch(/\) select kind, count\(\*\) as n, md5\(string_agg\(key \|\| '=' \|\| coalesce\(def, ''\), chr\(10\) order by key collate "c", def collate "c"\)\) as digest from items group by kind order by kind collate "c";$/);
    expect(oneLine(read("parity/fingerprint-detail.sql"))).toMatch(/\) select kind, key, def from items order by kind collate "c", key collate "c", def collate "c";$/);
  });

  /**
   * Production's database uses an ICU collation; a new project may not. Text
   * sorted under two collations aggregates in two orders, and two orders are
   * two digests for identical catalogues. `collate "C"` (bytewise) is the
   * same everywhere. The one non-text sort key is the enum's sort order.
   */
  it.each(["parity/fingerprint.sql", "parity/fingerprint-detail.sql"])(
    "%s sorts every text key by the C collation", (f) => {
      const clauses = [...oneLine(read(f)).matchAll(/order by (.*?)(?=\)|;)/g)].map((m) => m[1]!);
      // 6 inside the item list, plus the summary's digest + group order (8)
      // or the detail's row order (7): a floor, so a regex that stopped
      // matching cannot pass by inspecting nothing.
      expect(clauses.length).toBeGreaterThanOrEqual(7);
      for (const clause of clauses) {
        for (const key of clause.split(",").map((s) => s.trim())) {
          if (key === "e.enumsortorder") continue;
          expect(key, `order by ${clause}`).toMatch(/ collate "c"$/);
        }
      }
    },
  );

  /**
   * Rows the platform owns, which would otherwise be the whole of the first
   * diff (review of PR #130): production holds 188 btree_gist functions in
   * public owned by supabase_admin, supabase_admin's own default privileges,
   * storage's platform ACL, and the platform's extensions and event triggers.
   * None is something a migration made; each is scoped out here so the diff
   * shows only what the files are responsible for.
   */
  describe("scopes out what the platform owns", () => {
    const items = () => oneLine(itemList(read("parity/fingerprint.sql")));
    const branch = (kind: string) => {
      const all = items();
      const start = all.indexOf(`select '${kind}'`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = all.indexOf(" union all ", start);
      return all.slice(start, end === -1 ? undefined : end);
    };
    const NOT_AN_EXTENSION_MEMBER = (catalog: string, oid: string) =>
      `not exists (select 1 from pg_depend dep where dep.classid = '${catalog}'::regclass and dep.objid = ${oid} and dep.deptype = 'e')`;

    it("compares only the extensions the migrations use", () => {
      expect(branch("extension")).toContain("where e.extname in ('btree_gist', 'plpgsql')");
      expect(branch("extension_version(info)")).toContain("where e.extname in ('btree_gist', 'plpgsql')");
    });

    it("skips functions that belong to an extension", () => {
      expect(branch("function")).toContain(NOT_AN_EXTENSION_MEMBER("pg_proc", "p.oid"));
    });

    it("skips relations that belong to an extension", () => {
      expect(branch("relation")).toContain(NOT_AN_EXTENSION_MEMBER("pg_class", "c.oid"));
    });

    it("compares only postgres's default privileges", () => {
      expect(branch("default_acl")).toContain("where d.defaclrole = 'postgres'::regrole");
    });

    it("compares only our schemas' ACLs, and only our roles in them", () => {
      const b = branch("schema_acl");
      expect(b).toContain("where n.nspname in ('public', 'app')");
      expect(b).toContain("x.grantee in ('postgres'::regrole, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)");
    });

    it("compares only event triggers postgres owns", () => {
      expect(branch("event_trigger")).toContain("where e.evtowner = 'postgres'::regrole");
    });
  });
});
