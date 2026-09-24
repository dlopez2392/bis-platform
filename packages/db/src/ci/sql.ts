/**
 * Plans `ci:sql <file> [--allow-write]`: one SQL file, run on the CI project
 * through `pg`.
 *
 * Why this exists. The plan ran its CI-project SQL (O4's default-ACL read,
 * O5's bootstrap, O8's parity fingerprint) through the Supabase MCP. The
 * connector authorizes ONE organization and stays on production's, so it
 * cannot reach the CI project (`bis-ci`, a separate Free org). This is the
 * replacement: the same `pg` driver the db suite uses, behind the same guard
 * as `db:push:ci`.
 *
 * Reads are the default and are held to it twice:
 *   1. `sqlRefusals` (below) refuses, before connecting, any statement that is
 *      not plainly a read. It is lexical — comments, string literals, quoted
 *      identifiers and dollar-quoted bodies are blanked first, so a write
 *      word in a literal is not a write — and it is a denylist over what may
 *      appear inside a read, so it is a first gate, not a proof.
 *   2. ./sql-run.ts runs a read inside `begin read only` and rolls it back, so
 *      a write the lexer misses is refused by Postgres itself.
 * The one thing layer 2 cannot defend is its own transaction ending early —
 * a `commit` in the file would end the read-only transaction and run the rest
 * in autocommit — so transaction control is refused by layer 1 in BOTH modes.
 *
 * Writes need `--allow-write`, and then the whole file runs in ONE transaction
 * and commits, so a bootstrap that fails half-way leaves nothing behind.
 *
 * A migration file is refused in both modes. Migrations reach the CI project
 * through `db:push:ci`, which records them in
 * `supabase_migrations.schema_migrations`; one applied through here would be
 * in the schema but not the history, and the next push would try it again.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { assertCiTarget, describeCiTarget, nameArgument, type CiTarget } from "./target";

const ALLOW_WRITE = "--allow-write";

export function planCiSql(
  env: Record<string, string | undefined>,
  argv: readonly string[],
  paths: { cwd: string; packageDir: string },
): { target: CiTarget; file: string; allowWrite: boolean; summary: string } {
  const target = assertCiTarget({
    ref: env.BIS_CI_SUPABASE_REF,
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    dbUrl: env.SUPABASE_DB_URL,
  });

  const files: string[] = [];
  let allowWrite = false;
  for (const arg of argv) {
    if (arg === ALLOW_WRITE) allowWrite = true;
    else if (arg.startsWith("-")) throw new Error(`refusing ${nameArgument(arg)}: ci:sql takes one .sql file and optionally ${ALLOW_WRITE}`);
    else files.push(arg);
  }
  // Counts, not the arguments themselves: one of them may be a URL with a
  // password in it, typed where the file name should have gone.
  if (files.length !== 1 || !files[0]!.toLowerCase().endsWith(".sql")) {
    throw new Error(`ci:sql needs exactly one .sql file (got ${files.length} argument${files.length === 1 ? "" : "s"} that ${files.length === 1 ? "is" : "are"} not a flag)`);
  }

  const file = resolve(paths.cwd, files[0]!);
  const fromMigrations = relative(resolve(paths.packageDir, "supabase", "migrations"), file);
  if (!fromMigrations.startsWith("..") && !isAbsolute(fromMigrations)) {
    throw new Error(`${files[0]} is a migration: apply it with db:push:ci, which records it in the migration history`);
  }

  const mode = allowWrite
    ? "WRITE: one transaction, committed"
    : "read only: inside BEGIN READ ONLY, rolled back";
  const summary = `ci:sql ${files[0]} (${mode})\n${describeCiTarget(target)}`;
  return { target, file, allowWrite, summary };
}

/** Statements a read may start with. `explain` is out: `explain analyze` executes. */
const READ_LEADERS = new Set(["select", "with", "values", "table", "show"]);

/** Transaction control. The runner owns the transaction, in both modes. */
const TX_CONTROL = new Set(["begin", "start", "commit", "end", "rollback", "abort", "savepoint", "release", "prepare"]);

/**
 * Words that, anywhere inside a statement that starts like a read, make it
 * something else: a data-modifying CTE, `select … into` (creates a table),
 * `for update` (row locks), sequence advances, a `set_config` that could flip
 * `transaction_read_only`, and the server-side file, backend and remote-link
 * functions nothing in this repo has any business calling from a parity read.
 */
const NOT_IN_A_READ = new Set([
  "insert", "update", "delete", "merge", "truncate", "into",
  "nextval", "setval", "set_config",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "lo_import", "lo_export",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
  "dblink", "dblink_exec", "pg_advisory_lock", "pg_advisory_xact_lock",
]);

/**
 * Replaces every comment, string literal, quoted identifier and dollar-quoted
 * body with a space, so what is left is keywords, identifiers, operators and
 * semicolons. Nested block comments nest, as they do in Postgres. An E''
 * string honours backslash escapes; a standard one only doubles its quote.
 */
function blankNonCode(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  const isIdent = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$]/.test(c);
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      out += " ";
    } else if (c === "'") {
      const escapes = (sql[i - 1] === "e" || sql[i - 1] === "E") && !isIdent(sql[i - 2]);
      i++;
      while (i < n) {
        if (escapes && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += " ";
    } else if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += " ";
    } else if (c === "$" && !isIdent(sql[i - 1])) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (!tag) { out += c; i++; continue; }
      const close = sql.indexOf(tag[0], i + tag[0].length);
      i = close === -1 ? n : close + tag[0].length;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Why a file may not run in this mode, one line per refused statement; empty
 * means it may. Statements are numbered from 1 in file order, counting only
 * statements that hold code (a trailing `;` or a comment-only chunk is not one).
 */
export function sqlRefusals(sql: string, opts: { allowWrite: boolean }): string[] {
  const statements = blankNonCode(sql)
    .split(";")
    .map((s) => (s.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? []))
    .filter((words) => words.length > 0);
  if (statements.length === 0) return ["the file has no statements"];

  const refusals: string[] = [];
  statements.forEach((words, index) => {
    const at = `statement ${index + 1}`;
    const leader = words[0]!;
    if (TX_CONTROL.has(leader)) {
      refusals.push(`${at} is transaction control ("${leader}"); ci:sql owns the transaction`);
      return;
    }
    if (opts.allowWrite) return;
    if (!READ_LEADERS.has(leader)) {
      refusals.push(`${at} starts with "${leader}", which is not a read`);
      return;
    }
    const bad = words.find((w) => NOT_IN_A_READ.has(w));
    if (bad) refusals.push(`${at} uses "${bad}", which a read may not use`);
  });
  return refusals;
}
