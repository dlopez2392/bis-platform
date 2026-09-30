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
 *      not plainly a read. It is lexical — comments, string literals and
 *      dollar-quoted bodies are blanked first, so a write word in a literal
 *      is not a write; a quoted identifier is kept and checked against the
 *      function deny list, and a `U&"…"` one is refused — and it is a
 *      denylist over what may appear inside a read, so it is a first gate,
 *      not a proof.
 *   2. `runSqlFile` (below) runs a read inside `begin read only` and rolls it
 *      back, so a TABLE or SEQUENCE write the lexer misses is refused by
 *      Postgres itself.
 * Layer 2 is narrower than it sounds (review of PR #130). A read-only
 * transaction does not stop functions whose side effects live outside the
 * transaction's writes: advisory locks, `pg_stat_reset*`, `pg_notify`,
 * large-object functions (`lo_unlink` and friends), dblink, replication
 * slots, WAL and backend control. For those layer 1 is the ONLY defence, so
 * they are on its deny list — by name, and by prefix for the families
 * (`NOT_IN_A_READ`, `NOT_IN_A_READ_PREFIXES`). A deny list is not a proof;
 * the files this runs are few and reviewed, and that is the real control.
 * Layer 2 also cannot defend its own transaction ending early — a `commit` in
 * the file would end the read-only transaction and run the rest in
 * autocommit — so transaction control is refused by layer 1 in BOTH modes.
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
import {
  assertCiTarget, ciDbUrlParts, describeCiTarget, isConnectionOverride, nameArgument, type CiTarget,
} from "./target";

const ALLOW_WRITE = "--allow-write";

/**
 * What ./sql-run.ts builds its pg Client from. Deletes every
 * `isConnectionOverride` variable from `env` IN PLACE first — the runner
 * passes `process.env`, which is where pg reads its PG* fallbacks at Client
 * construction — then returns `pgClientConfig(env)`.
 *
 * The strip is load-bearing, not tidiness (re-review of PR #130): pg treats
 * a falsy config field as unset, so `options: ""` still takes PGOPTIONS
 * (`-c role=…`), and only removing the variable closes that. Tested against
 * pg itself in ./sql.test.ts.
 */
export function ciSqlClientConfig(env: Record<string, string | undefined>): ReturnType<typeof pgClientConfig> {
  for (const key of Object.keys(env)) {
    if (isConnectionOverride(key)) delete env[key];
  }
  return pgClientConfig(env);
}

/**
 * What ci:sql hands `new pg.Client(...)`: every field explicit, built from
 * the guard-validated parts of SUPABASE_DB_URL, and NO connection string.
 * pg merges a connection string's query OVER explicit config (a URL's
 * `sslmode=require` would replace `ssl` below) and fills any absent field
 * from PG* env vars; with every field given and no URL left to parse,
 * neither can happen. ./sql-run.ts also drops PG* from its own env first.
 *
 * TLS always (re-review of PR #130: node-pg, unlike the CLI, does not force
 * it, and a URL with no sslmode connected in plaintext). The certificate is
 * NOT verified: ASSUMPTION, not checked this session, that the pooler's
 * certificate chains to Supabase's own root CA rather than one in Node's
 * store, as Supabase's downloadable "SSL certificate" suggests. Verifying it
 * means shipping that CA and passing it as `ssl.ca` — a follow-up, recorded
 * in the report. Encryption without verification still keeps the password
 * and the rows off the wire in the clear.
 */
export function pgClientConfig(env: Record<string, string | undefined>): {
  host: string; port: number; user: string; password: string; database: "postgres";
  application_name: string; ssl: { rejectUnauthorized: false }; connectionTimeoutMillis: number;
} {
  const target = assertCiTarget({
    ref: env.BIS_CI_SUPABASE_REF,
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    dbUrl: env.SUPABASE_DB_URL,
  });
  const parts = ciDbUrlParts(env.SUPABASE_DB_URL!.trim(), target.ref);
  let password: string;
  try {
    password = decodeURIComponent(parts.password);
  } catch {
    throw new Error("SUPABASE_DB_URL password has a %XX escape that is not valid UTF-8");
  }
  return {
    host: parts.host, port: parts.port, user: parts.user, password, database: "postgres",
    // Explicit, so PGAPPNAME cannot supply it. `options` cannot be pinned the
    // same way — pg treats "" as unset and takes PGOPTIONS — which is why
    // `ciSqlClientConfig` strips the env first.
    application_name: "bis-ci-sql",
    ssl: { rejectUnauthorized: false },
    // Ten seconds, as in test/db.ts: an unreachable host otherwise hangs
    // forever instead of naming itself.
    connectionTimeoutMillis: 10_000,
  };
}

/**
 * Runs `sql` inside the one transaction ci:sql owns: `begin read only` …
 * `rollback` for a read, `begin` … `commit` for a write. On any error it rolls
 * back and rethrows the STATEMENT's error (a failing rollback is swallowed so
 * it cannot hide the cause). Returns every result set the driver produced —
 * pg gives one object for a one-statement file and an array for several.
 *
 * Takes any `{ query }` so the sequence is tested with a recording fake
 * (./sql.test.ts); ./sql-run.ts passes a real pg Client.
 */
export async function runSqlFile(
  client: { query(text: string): Promise<unknown> }, sql: string, opts: { allowWrite: boolean },
): Promise<unknown[]> {
  await client.query(opts.allowWrite ? "begin" : "begin read only");
  let results: unknown;
  try {
    await client.query("set local statement_timeout = '120s'");
    results = await client.query(sql);
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // The statement's error is the one worth reporting.
    }
    throw e;
  }
  await client.query(opts.allowWrite ? "commit" : "rollback");
  return Array.isArray(results) ? results : [results];
}

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
 * SQL keywords that, anywhere inside a statement that starts like a read,
 * make it something else: a data-modifying CTE, `select … into` (creates a
 * table), `for update` (row locks). Keywords only count UNQUOTED — `"delete"`
 * is an identifier, never the keyword — so `select 1 as "delete"` is a read.
 */
const SYNTAX_NOT_IN_A_READ = new Set(["insert", "update", "delete", "merge", "truncate", "into"]);

/**
 * Functions a read may not call, quoted or not (`"pg_notify"(…)` calls
 * pg_notify): sequence advances, a `set_config` that could flip
 * `transaction_read_only`, and the server-side file, backend, remote-link,
 * notify and WAL functions nothing in this repo has any business calling from
 * a parity read.
 */
const NOT_IN_A_READ = new Set([
  "nextval", "setval", "set_config",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "lo_import", "lo_export",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
  "dblink", "dblink_exec", "pg_advisory_lock", "pg_advisory_xact_lock",
  "pg_notify", "pg_switch_wal", "pg_promote", "pg_create_restore_point", "pg_log_backend_memory_contexts",
]);

/**
 * Function FAMILIES whose side effects a read-only transaction does not stop
 * (see the header): advisory locks and unlocks, statistics resets, large
 * objects, dblink, replication slots and origins, logical decoding messages,
 * backup and WAL-replay control. Matched as prefixes so a sibling nobody
 * listed (`pg_advisory_unlock_shared`, `lo_truncate64`) is refused too.
 */
const NOT_IN_A_READ_PREFIXES = [
  "pg_advisory_", "pg_try_advisory_", "pg_stat_reset", "lo_", "dblink_",
  "pg_create_", "pg_drop_", "pg_replication_", "pg_logical_", "pg_copy_",
  "pg_backup_", "pg_wal_replay_",
];

/** A function name a read may not call. Exact: Postgres never folds a quoted name. */
const deniedFunction = (name: string) =>
  NOT_IN_A_READ.has(name) || NOT_IN_A_READ_PREFIXES.some((p) => name.startsWith(p));

/** An unquoted word a read may not contain (already lower-cased: Postgres folds these). */
const deniedInRead = (word: string) => SYNTAX_NOT_IN_A_READ.has(word) || deniedFunction(word);

/**
 * Markers `blankNonCode` leaves where a quoted identifier stood. Control
 * characters, so no SQL word can contain them; the identifier's text rides
 * between them as hex, so a `;` or `"` inside it cannot split a statement.
 */
const QUOTED = "\u0001";
const UNICODE_QUOTED = "\u0002";

/**
 * Replaces every comment, string literal and dollar-quoted body with a space,
 * so what is left is keywords, identifiers, operators and semicolons. Nested
 * block comments nest, as they do in Postgres. An E'' string honours
 * backslash escapes; a standard one only doubles its quote.
 *
 * A quoted identifier is NOT blanked (re-review of PR #130: blanking hid
 * `"pg_notify"(…)` from the deny list). Its text, `""` collapsed to `"`,
 * becomes a QUOTED-marked hex token that `sqlRefusals` checks against the
 * function deny list. A `U&"…"` identifier, whose escapes can spell any name,
 * becomes a bare UNICODE_QUOTED marker and a read refuses it outright.
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
      const unicode = sql[i - 1] === "&" && (sql[i - 2] === "U" || sql[i - 2] === "u") && !isIdent(sql[i - 3]);
      let text = "";
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { text += '"'; i += 2; continue; }
          i++;
          break;
        }
        text += sql[i];
        i++;
      }
      out += unicode
        ? ` ${UNICODE_QUOTED} `
        : ` ${QUOTED}${Buffer.from(text, "utf8").toString("hex")}${QUOTED} `;
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
  const quotedToken = new RegExp(`${QUOTED}([0-9a-f]*)${QUOTED}`, "g");
  const statements = blankNonCode(sql)
    .split(";")
    .map((s) => ({
      quoted: [...s.matchAll(quotedToken)].map((m) => Buffer.from(m[1]!, "hex").toString("utf8")),
      unicode: s.includes(UNICODE_QUOTED),
      // Markers out BEFORE words are read: their hex would otherwise read as words.
      words: s.replace(quotedToken, " ").toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [],
    }))
    .filter((st) => st.words.length > 0 || st.quoted.length > 0 || st.unicode);
  if (statements.length === 0) return ["the file has no statements"];

  const refusals: string[] = [];
  statements.forEach(({ words, quoted, unicode }, index) => {
    const at = `statement ${index + 1}`;
    const leader = words[0] ?? "";
    if (TX_CONTROL.has(leader)) {
      refusals.push(`${at} is transaction control ("${leader}"); ci:sql owns the transaction`);
      return;
    }
    if (opts.allowWrite) return;
    if (!READ_LEADERS.has(leader)) {
      refusals.push(leader ? `${at} starts with "${leader}", which is not a read` : `${at} does not start with a keyword, so it is not a read`);
      return;
    }
    const bad = words.find(deniedInRead) ?? quoted.find(deniedFunction);
    if (bad) refusals.push(`${at} uses "${bad}", which a read may not use`);
    else if (unicode) refusals.push(`${at} uses a U&"..." identifier, which a read may not use`);
  });
  return refusals;
}
