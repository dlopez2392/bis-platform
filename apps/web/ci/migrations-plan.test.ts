import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// .github/scripts/migrations-plan.mjs, ci.yml's `migrations-plan` part of the
// `e2e` gate (plan docs/superpowers/plans/2026-11-13-migration-pipeline.md, D2
// and PR 2). It holds no credential and reads nothing but git: what the
// branch changes under packages/db/supabase/migrations/ against its merge base
// with main, and the SQL of each file it adds. It refuses what the pipeline
// cannot apply safely, before anything is applied anywhere.
//
// Run for real, with node and git, against repositories built in a temp
// directory: an `origin` with a `main` and one branch per case, cloned the
// way actions/checkout clones (`--depth 1`, file://), so the script must
// fetch main's history itself, as it must on a runner. No network.

const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/migrations-plan.mjs", import.meta.url));
const DIR = "packages/db/supabase/migrations";

vi.setConfig({ testTimeout: 60_000 });

let root = "";
let origin = "";
let work = "";
let gitEnv: NodeJS.ProcessEnv = { ...process.env };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

/** Write (string) or delete (null) each path, or rename with { from }, then commit. */
function commit(changes: Record<string, string | null | { from: string }>, message: string) {
  for (const [file, content] of Object.entries(changes)) {
    const full = path.join(work, file);
    if (content === null) {
      git(work, "rm", "-q", file);
    } else if (typeof content === "object") {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      git(work, "mv", content.from, file);
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      git(work, "add", "--", file);
    }
  }
  git(work, "commit", "-q", "-m", message);
}

/** A branch off origin's CURRENT main carrying each commit in turn, pushed. */
function branch(name: string, ...commits: Record<string, string | null | { from: string }>[]) {
  git(work, "checkout", "-q", "-B", name, "origin/main");
  commits.forEach((c, i) => commit(c, `${name} ${i}`));
  git(work, "push", "-q", "origin", `${name}:${name}`);
}

/** A branch adding ONE new migration with this SQL. */
const NEW = `${DIR}/20261114093000_change.sql`;
const adds = (name: string, sql: string) => branch(name, { [NEW]: sql });

const LEGACY_A = "create table a (id int primary key);\n-- a body long enough for rename detection to pair it\n".repeat(4);

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-plan-"));
  const globalConfig = path.join(root, "gitconfig");
  fs.writeFileSync(globalConfig, "");
  gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  for (const k of Object.keys(gitEnv)) if (k.startsWith("GITHUB_")) delete gitEnv[k];

  origin = path.join(root, "origin.git");
  work = path.join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: gitEnv });
  execFileSync("git", ["clone", "-q", pathToFileURL(origin).href, work], { env: gitEnv });
  git(work, "checkout", "-q", "-b", "main");
  commit({
    [`${DIR}/0001_a.sql`]: LEGACY_A,
    [`${DIR}/0002_b.sql`]: "create table b (id int);\n",
    ".github/workflows/ci.yml": "on: push\n",
    "packages/db/supabase/parity/fingerprint.sql": "select 1;\n",
    "apps/web/src/x.ts": "export {};\n",
    "README.md": "# repo\n",
  }, "base");
  git(work, "push", "-q", "origin", "main");
  git(work, "fetch", "-q", "origin");

  // Allowed.
  adds("clean", "create table t (id int primary key);\n");
  branch("no-migration", { "apps/web/src/x.ts": "export const y = 1;\n" });
  branch("pipeline-only", { ".github/workflows/ci.yml": "on: [push]\n" });
  adds("hidden-in-comments-strings-and-bodies", [
    "-- create index concurrently is not run here; neither is commit;",
    "/* a block comment: drop table x; vacuum; /* nested: rename */ still comment: concurrently */",
    "comment on table b is 'drop column, concurrently, :bis_mig_x and commit; inside a string';",
    "create function f() returns void language plpgsql as $body$",
    "begin",
    "\\ a backslash line inside a dollar-quoted body is not a psql command",
    "  perform E'it''s \\\\ a backslash in an escape string' || 'and \\ one in a plain string';",
    "  perform 1;",
    "end;",
    "$body$;",
    "do $$ begin raise notice 'x'; end $$;",
    "create table \"Concurrently\" (id int);",
    "select x::bis_mig_type from b;",
    "",
  ].join("\n"));
  adds("begin-atomic", "create function g() returns int language sql begin atomic select 1; end;\n");
  adds("contract-with-reason", "-- contract: nothing on main reads b.old since #300\nalter table b drop column old;\n");
  adds("drop-constraint", "alter table b drop constraint b_pkey;\n");

  // Refused: what the branch does to files already on main.
  branch("edit-main-file", { [`${DIR}/0002_b.sql`]: "create table b (id int, x int);\n" });
  branch("delete-main-file", { [`${DIR}/0002_b.sql`]: null });
  branch("rename-main-file", { [`${DIR}/20261114093000_a.sql`]: { from: `${DIR}/0001_a.sql` } });
  branch("add-numbered", { [`${DIR}/0003_c.sql`]: "create table c (id int);\n" });

  // Refused: SQL the runner cannot apply inside its one transaction.
  adds("concurrently", "create index concurrently b_id on b (id);\n");
  adds("concurrently-upper", "CREATE INDEX CONCURRENTLY b_id ON b (id);\n");
  adds("commit", "create table t (id int);\ncommit;\n");
  adds("begin", "begin;\ncreate table t (id int);\n");
  adds("vacuum", "vacuum analyze b;\n");
  adds("backslash", "\\set x 1\ncreate table t (id int);\n");
  adds("backslash-mid-line", "create table t (id int);\nselect count(*) from t \\gset\n");
  adds("bis-mig-variable", "select :'bis_mig_content';\n");

  // Refused: contract changes with no reason given.
  adds("drop-column", "alter table b drop column old;\n");
  adds("drop-column-upper", "ALTER TABLE b DROP COLUMN old;\n");
  adds("drop-table", "drop table if exists b;\n");
  adds("rename", "alter table b rename to bee;\n");
  adds("contract-without-reason", "-- contract:\nalter table b drop column old;\n");

  // Refused: a migration and a pipeline change in one branch (owner Q6).
  branch("migration-and-workflow", { [NEW]: "create table t (id int);\n", ".github/workflows/ci.yml": "on: [push]\n" });
  branch("migration-and-parity", { [NEW]: "create table t (id int);\n", "packages/db/supabase/parity/fingerprint.sql": "select 2;\n" });

  // main moves on with ANOTHER branch's migration after this one forked: only
  // this branch's own file is listed, and main's is no concern of this run.
  adds("behind-main", "create table behind (id int);\n");
  git(work, "checkout", "-q", "main");
  commit({ [`${DIR}/20261114080000_other.sql`]: "create index concurrently o on b (id);\n" }, "another branch merged");
  git(work, "push", "-q", "origin", "main");
  git(work, "fetch", "-q", "origin");
}, 240_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

type Result = { status: number | null; output: string };

/** Clone `branchName` the way actions/checkout does, then run the script in it. */
function plan(branchName: string): Result {
  const clone = fs.mkdtempSync(path.join(root, "ci-"));
  execFileSync("git", ["clone", "-q", "--depth", "1", "--no-tags", "--branch", branchName, pathToFileURL(origin).href, clone], { env: gitEnv });
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: clone, encoding: "utf8", env: gitEnv });
  if (run.error) throw run.error;
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const refused = (r: Result, pattern: RegExp) => {
  expect(r.status, r.output).toBe(1);
  expect(r.output).toMatch(pattern);
};

describe("migrations-plan.mjs lets through what the pipeline can apply", () => {
  it("passes a branch that adds one clean timestamped migration, and names it", () => {
    const r = plan("clean");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("20261114093000_change.sql");
    expect(r.output).not.toContain("::error::");
  });

  it.each(["no-migration", "pipeline-only", "main"])("passes %s: nothing to refuse", (name) => {
    const r = plan(name);
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain("::error::");
  });

  it("reads past comments, block comments (nested), strings, quoted identifiers, casts and dollar-quoted bodies (mutation: scan comments too → FAILS)", () => {
    const r = plan("hidden-in-comments-strings-and-bodies");
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
  });

  it("passes a SQL-standard function body: its BEGIN ATOMIC ... END is not a transaction", () => {
    const r = plan("begin-atomic");
    expect(r.status, r.output).toBe(0);
  });

  it("passes a contract change that says why in a `-- contract:` line", () => {
    const r = plan("contract-with-reason");
    expect(r.status, r.output).toBe(0);
  });

  it("passes dropping a constraint: only tables, columns and renames are contract changes", () => {
    expect(plan("drop-constraint").status).toBe(0);
  });

  it("checks only what THIS branch adds: main's later migration, merged by another branch, is not this run's concern", () => {
    const r = plan("behind-main");
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("20261114093000_change.sql");
    expect(r.output).not.toContain("20261114080000_other.sql");
  });
});

describe("migrations-plan.mjs refuses a change to a migration that is already on main", () => {
  it("refuses an edit, naming the file and the fix", () => {
    refused(plan("edit-main-file"), /::error::.*0002_b\.sql.*modifies it.*NEW migration.*migration:new/);
  });

  it("refuses a deletion", () => {
    refused(plan("delete-main-file"), /::error::.*0002_b\.sql.*deletes it/);
  });

  it("refuses a rename, even to a valid new name (mutation: count a rename's new path as an addition → FAILS)", () => {
    refused(plan("rename-main-file"), /::error::.*0001_a\.sql.*renames it to .*20261114093000_a\.sql/);
  });

  it("refuses an added NUMBERED migration", () => {
    refused(plan("add-numbered"), /::error::.*0003_c\.sql.*YYYYMMDDHHMMSS_slug\.sql.*migration:new/);
  });
});

describe("migrations-plan.mjs refuses SQL the runner cannot apply in its one transaction", () => {
  it.each([
    ["concurrently", /::error::.*20261114093000_change\.sql:1: CONCURRENTLY/],
    ["concurrently-upper", /::error::.*20261114093000_change\.sql:1: CONCURRENTLY/],
    ["commit", /::error::.*:2: COMMIT at the top level/],
    ["begin", /::error::.*:1: BEGIN at the top level/],
    ["vacuum", /::error::.*:1: VACUUM/],
    ["backslash", /::error::.*:1: a backslash outside a string is a psql meta-command/],
    ["backslash-mid-line", /::error::.*:2: a backslash outside a string is a psql meta-command/],
    ["bis-mig-variable", /::error::.*:1: .*:bis_mig_/],
  ])("refuses %s, naming the file and line", (name, pattern) => {
    refused(plan(name), pattern);
  });
});

describe("migrations-plan.mjs refuses a contract change with no `-- contract:` reason", () => {
  it.each([
    ["drop-column", /::error::.*:1: DROP COLUMN without a "-- contract: <why>" line/],
    ["drop-column-upper", /::error::.*:1: DROP COLUMN without/],
    ["drop-table", /::error::.*:1: DROP TABLE without/],
    ["rename", /::error::.*:1: RENAME without/],
    ["contract-without-reason", /::error::.*:2: DROP COLUMN without/],
  ])("refuses %s (mutation: match case-sensitively → the upper-case case FAILS)", (name, pattern) => {
    refused(plan(name), pattern);
  });
});

describe("migrations-plan.mjs refuses a branch that adds a migration AND changes the pipeline (owner decision Q6, 2026-11-13)", () => {
  it.each([
    ["migration-and-workflow", ".github/workflows/ci.yml"],
    ["migration-and-parity", "packages/db/supabase/parity/fingerprint.sql"],
  ])("refuses %s, naming both sides (mutation: drop the rule → FAILS)", (name, pipelineFile) => {
    const r = plan(name);
    refused(r, /::error::.*adds a migration.*AND changes the migration pipeline/);
    expect(r.output).toContain("20261114093000_change.sql");
    expect(r.output).toContain(pipelineFile);
  });
});
