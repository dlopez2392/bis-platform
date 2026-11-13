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
  // ALTER TABLE's DROPs that remove nothing the app reads (review of #366, item 2).
  adds("alter-drop-harmless", [
    "alter table b drop constraint if exists b_pkey;",
    "alter table b alter column id drop default;",
    "alter table b alter column id drop not null;",
    "alter table b alter column id drop identity if exists;",
    "alter table b alter column id drop expression;",
    "",
  ].join("\n"));
  // TRUNCATE inside a grant is a privilege, not a statement (5 legacy files).
  adds("truncate-in-grant", "revoke insert, update, delete, truncate on b from anon;\ngrant truncate on b to service_role;\n");
  // The string lexer's own rules, OUTSIDE any dollar body so they reach it
  // (review of #366, item 6): E-string backslash escapes, doubled quotes in
  // strings and identifiers. Each hides a `commit;` that must stay hidden.
  adds("strings-hide-commit", [
    "select E'it\\'s; commit; \\\\';",
    "select 'it''s; commit;';",
    // '' matters inside an E-string: split there, the second piece would lose
    // its escape mode, end at the \' and expose the commit.
    "select E'it''s \\' still; commit; inside';",
    "create table \"a\"\"b; commit;\" (id int);",
    "",
  ].join("\n"));
  // `$` inside an identifier opens no dollar quote, so the COMMIT after it is seen.
  adds("dollar-in-identifier", "create table t$x$ (id int);\ncommit;\n");
  // A BEGIN ATOMIC body ends at its END: a COMMIT after it is seen.
  adds("after-begin-atomic", "create function g() returns int language sql begin atomic select 1; end;\ncommit;\n");
  // A `-- contract:` line inside a string or a dollar body is no contract line.
  adds("contract-in-string", "comment on table b is '\n-- contract: not a comment\n';\nalter table b drop column old;\n");
  adds("contract-in-dollar-body", "do $$ begin\n-- contract: not top level\nperform 1; end $$;\nalter table b drop column old;\n");

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
  adds("bis-mig-unquoted", "select :bis_mig_x;\n");
  adds("end", "create table t (id int);\nend;\n");
  adds("rollback", "create table t (id int);\nROLLBACK;\n");
  adds("commit-mixed-case", "create table t (id int);\nCoMmIt;\n");
  adds("vacuum-upper", "VACUUM b;\n");
  adds("standard-conforming-strings", "set standard_conforming_strings = off;\ncreate table t (id int);\n");
  adds("standard-conforming-strings-in-string", "select set_config('standard_conforming_strings', 'off', false);\n");

  // Refused: contract changes with no reason given.
  adds("drop-column", "alter table b drop column old;\n");
  adds("drop-column-upper", "ALTER TABLE b DROP COLUMN old;\n");
  adds("drop-table", "drop table if exists b;\n");
  adds("rename", "alter table b rename to bee;\n");
  adds("contract-without-reason", "-- contract:\nalter table b drop column old;\n");
  // Review of #366, items 1-3: what the first rules missed.
  adds("drop-table-in-do", "do $$ begin\n  if true then\n    drop table public.b;\n  end if;\nend $$;\n");
  adds("alter-drop-without-column", "alter table b drop old;\n");
  adds("alter-drop-if-exists", "alter table b drop if exists old;\n");
  adds("drop-function", "drop function if exists public.f(int);\n");
  adds("drop-procedure", "drop procedure p();\n");
  adds("drop-view", "drop view if exists v;\n");
  adds("drop-materialized-view", "drop materialized view mv;\n");
  adds("truncate", "create table t (id int);\ntruncate b;\n");

  // Refused: a migration and a pipeline change in one branch (owner Q6), one
  // branch per pipeline pattern.
  const withMigration = (name: string, pipelineFile: string) =>
    branch(name, { [NEW]: "create table t (id int);\n", [pipelineFile]: "changed\n" });
  withMigration("migration-and-workflow", ".github/workflows/ci.yml");
  withMigration("migration-and-parity", "packages/db/supabase/parity/fingerprint.sql");
  withMigration("migration-and-ci-script", ".github/scripts/ci-local-supabase.sh");
  withMigration("migration-and-migrations-script", ".github/scripts/migrations-apply.sh");
  withMigration("migration-and-bootstrap", "packages/db/supabase/bootstrap/ci-project.sql");
  withMigration("migration-and-names", "packages/db/src/migrations/names.ts");
  withMigration("migration-and-db-ci", "packages/db/src/ci/push.ts");
  withMigration("migration-and-config-toml", "packages/db/supabase/config.toml");
  // Not the pipeline: a migration may come with these.
  withMigration("migration-and-package-json", "packages/db/package.json");
  withMigration("migration-and-other-script", ".github/scripts/sofia-corpus-seal.sh");

  // A branch with no history in common with main.
  git(work, "checkout", "-q", "--orphan", "orphan");
  git(work, "rm", "-rqf", ".");
  commit({ [NEW]: "create table t (id int);\n" }, "orphan");
  git(work, "push", "-q", "origin", "orphan:orphan");

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

/**
 * Clone `branchName` the way actions/checkout does, then run the script in it:
 * from `subdir` of the checkout when given, after `before` has had its way with
 * the clone (the fail-closed cases break something first).
 */
function plan(branchName: string, opts: { subdir?: string; before?: (clone: string) => void } = {}): Result {
  const clone = fs.mkdtempSync(path.join(root, "ci-"));
  execFileSync("git", ["clone", "-q", "--depth", "1", "--no-tags", "--branch", branchName, pathToFileURL(origin).href, clone], { env: gitEnv });
  opts.before?.(clone);
  const cwd = opts.subdir ? path.join(clone, opts.subdir) : clone;
  fs.mkdirSync(cwd, { recursive: true });
  const run = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8", env: gitEnv });
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

  it("passes ALTER TABLE's DROP CONSTRAINT / DEFAULT / NOT NULL / IDENTITY / EXPRESSION: none removes what the app reads (mutation: flag every ALTER TABLE ... DROP → FAILS)", () => {
    const r = plan("alter-drop-harmless");
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
  });

  it("passes TRUNCATE as a privilege in REVOKE and GRANT: only a TRUNCATE statement is a contract change (mutation: match the word anywhere → FAILS)", () => {
    const r = plan("truncate-in-grant");
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
  });

  it("keeps a COMMIT hidden inside an E-string with \\' escapes, a string with '' and an identifier with \"\" (mutation: drop E-string escapes, or the doubled-quote rule → FAILS)", () => {
    const r = plan("strings-hide-commit");
    expect(r.output).not.toContain("::error::");
    expect(r.status, r.output).toBe(0);
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
    ["bis-mig-unquoted", /::error::.*:1: .*:bis_mig_/],
    ["end", /::error::.*:2: END at the top level/],
    ["rollback", /::error::.*:2: ROLLBACK at the top level/],
    ["commit-mixed-case", /::error::.*:2: COMMIT at the top level/],
    ["vacuum-upper", /::error::.*:1: VACUUM/],
    // The lexer's own edges: a `$` inside an identifier opens no quote, and a
    // BEGIN ATOMIC body ends at its END, so the COMMIT after each is seen.
    ["dollar-in-identifier", /::error::.*:2: COMMIT at the top level/],
    ["after-begin-atomic", /::error::.*:2: COMMIT at the top level/],
  ])("refuses %s, naming the file and line", (name, pattern) => {
    refused(plan(name), pattern);
  });

  // standard_conforming_strings changes what a backslash in a plain string
  // means, so it could hide a statement from this lexer and from psql's: it
  // is refused wherever it appears, a string included.
  it.each(["standard-conforming-strings", "standard-conforming-strings-in-string"])(
    "refuses %s outright (mutation: drop the rule → FAILS)",
    (name) => {
      refused(plan(name), /::error::.*:1: standard_conforming_strings/);
    },
  );
});

describe("migrations-plan.mjs refuses a contract change with no `-- contract:` reason", () => {
  it.each([
    ["drop-column", /::error::.*:1: DROP COLUMN without a "-- contract: <why>" line/],
    ["drop-column-upper", /::error::.*:1: DROP COLUMN without/],
    ["drop-table", /::error::.*:1: DROP TABLE without/],
    ["rename", /::error::.*:1: RENAME without/],
    ["contract-without-reason", /::error::.*:2: DROP COLUMN without/],
    ["contract-in-string", /::error::.*:4: DROP COLUMN without/],
    ["contract-in-dollar-body", /::error::.*:4: DROP COLUMN without/],
    ["drop-table-in-do", /::error::.*:3: DROP TABLE without/],
    ["alter-drop-without-column", /::error::.*:1: DROP COLUMN without/],
    ["alter-drop-if-exists", /::error::.*:1: DROP COLUMN without/],
    ["drop-function", /::error::.*:1: DROP FUNCTION without/],
    ["drop-procedure", /::error::.*:1: DROP PROCEDURE without/],
    ["drop-view", /::error::.*:1: DROP VIEW without/],
    ["drop-materialized-view", /::error::.*:1: DROP VIEW without/],
    ["truncate", /::error::.*:2: TRUNCATE without/],
  ])("refuses %s (mutation: match case-sensitively → the upper-case case FAILS)", (name, pattern) => {
    refused(plan(name), pattern);
  });
});

describe("migrations-plan.mjs refuses a branch that adds a migration AND changes the pipeline (owner decision Q6, 2026-11-13)", () => {
  it.each([
    ["migration-and-workflow", ".github/workflows/ci.yml"],
    ["migration-and-parity", "packages/db/supabase/parity/fingerprint.sql"],
    ["migration-and-ci-script", ".github/scripts/ci-local-supabase.sh"],
    ["migration-and-migrations-script", ".github/scripts/migrations-apply.sh"],
    ["migration-and-bootstrap", "packages/db/supabase/bootstrap/ci-project.sql"],
    ["migration-and-names", "packages/db/src/migrations/names.ts"],
    ["migration-and-db-ci", "packages/db/src/ci/push.ts"],
    ["migration-and-config-toml", "packages/db/supabase/config.toml"],
  ])("refuses %s, naming both sides (mutation: drop that pattern, or the rule → FAILS)", (name, pipelineFile) => {
    const r = plan(name);
    refused(r, /::error::.*adds a migration.*AND changes the migration pipeline/);
    expect(r.output).toContain("20261114093000_change.sql");
    expect(r.output).toContain(pipelineFile);
  });

  it.each(["migration-and-package-json", "migration-and-other-script"])(
    "passes %s: a dependency bump or an unrelated script is not the pipeline",
    (name) => {
      const r = plan(name);
      expect(r.output).not.toContain("::error::");
      expect(r.status, r.output).toBe(0);
    },
  );
});

// Review of #366: a check that cannot read the branch must be RED, never a
// quiet pass (M01-M04 survived the first round because nothing broke git).
describe("migrations-plan.mjs fails closed when it cannot read the branch", () => {
  it("fails when main cannot be fetched (mutation: swallow the fetch error → FAILS)", () => {
    const r = plan("clean", { before: (clone) => git(clone, "remote", "set-url", "origin", pathToFileURL(path.join(root, "no-such-origin.git")).href) });
    refused(r, /::error::main's history could not be fetched\. A check that cannot read the branch is red/);
  });

  it("fails when the branch shares no history with main (mutation: swallow the merge-base error → FAILS)", () => {
    refused(plan("orphan"), /::error::this branch has no merge base with main\./);
  });

  it("fails when git cannot list the branch's changes (mutation: swallow the diff error → FAILS)", () => {
    // A config only `git diff` parses: fetch and merge-base still work.
    const r = plan("clean", { before: (clone) => git(clone, "config", "diff.renameLimit", "not-a-number") });
    refused(r, /::error::git could not list this branch's changes against main\./);
  });

  it("fails when an added migration is missing from the checkout (mutation: skip an unreadable file → FAILS)", () => {
    const r = plan("clean", { before: (clone) => fs.rmSync(path.join(clone, NEW)) });
    refused(r, /::error::.*20261114093000_change\.sql could not be read from the checkout\./);
  });

  it("runs from the repository root wherever it is started, so a subdirectory cannot make it pass (mutation: drop the chdir → FAILS)", () => {
    refused(plan("drop-column", { subdir: "apps/web" }), /::error::.*:1: DROP COLUMN without/);
  });
});
