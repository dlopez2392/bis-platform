#!/usr/bin/env node
// The migration plan check: ci.yml's `migrations-plan` part of the `e2e` gate
// (docs/superpowers/plans/2026-11-13-migration-pipeline.md, D2 and PR 2).
//
// Why. Since 2026-11-13 migrations are timestamped so two schema branches no
// longer collide, and the plan has CI apply a ready PR's new migrations to
// bis-ci, then (after the owner's click) to production, BEFORE the merge.
// Everything that makes such an apply unsafe can be seen in the branch alone,
// so it is refused here first, on every push, with no credential at all:
//
//   - a change to a migration already on main (edit, delete, rename, type
//     change): an applied migration is never changed; a fix is a new one;
//   - an added NUMBERED migration: numbers stopped at 0116;
//   - SQL the runner cannot apply inside the ONE transaction it opens per file:
//     top-level BEGIN/COMMIT/ROLLBACK/END and friends, CONCURRENTLY, VACUUM;
//   - psql syntax in the file (the runner applies through psql): a backslash
//     outside a string (a meta-command), or the runner's own variable prefix
//     `:bis_mig_`;
//   - a contract change (DROP TABLE, DROP COLUMN, RENAME) with no
//     `-- contract: <why>` line: production gets the migration BEFORE the app
//     that needs it deploys, so the app on main must keep working with it;
//   - a branch that adds a migration AND changes the migration pipeline
//     (owner decision Q6, 2026-11-13: never both in one PR).
//
// What "the branch" is: every change between the merge base with main and
// HEAD (the WHOLE branch, as ci-docs-only.sh reads it), so a migration main
// gained after the fork is not this run's concern. Comments, string literals,
// quoted identifiers and dollar-quoted bodies are read past, the way psql's
// lexer does, so a function body's BEGIN or a comment's "concurrently" is no
// refusal.
//
// Node built-ins and git only: no install, no secret, no network but git's
// fetch of main. A check that cannot read the branch is RED, never skipped.
// Exits 0 when nothing is refused, 1 otherwise. Prints file names, line
// numbers and rule names only.
//
// Tested by apps/web/ci/migrations-plan.test.ts (collected by `pnpm check`).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DIR = "packages/db/supabase/migrations/";
const NEW_NAME = /^[0-9]{14}_[a-z][a-z0-9_]*\.sql$/;
const NEW_FILE = "create new migrations with `pnpm --filter @bis/db migration:new <slug>`";
/** The migration pipeline: what decides how a migration is checked, applied and compared. */
const PIPELINE = [
  /^\.github\/workflows\//,
  /^\.github\/scripts\/(ci-|migrations-)/,
  /^packages\/db\/supabase\/(parity|bootstrap)\//,
  /^packages\/db\/src\/(migrations|ci)\//,
];

const errors = [];
const refuse = (message) => errors.push(message);

function fail(message) {
  console.log(`::error::${message} A check that cannot read the branch is red, not skipped.`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

// ---- the branch ------------------------------------------------------------

// actions/checkout fetches one commit; the merge base needs main's history.
try {
  const shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  git(["fetch", "--quiet", "--no-tags", ...(shallow ? ["--unshallow"] : []), "origin", "+refs/heads/main:refs/remotes/origin/main"]);
} catch {
  fail("main's history could not be fetched.");
}
let base = "";
try {
  base = git(["merge-base", "refs/remotes/origin/main", "HEAD"]).trim();
} catch {
  fail("this branch has no merge base with main.");
}

/** `git diff -z` name-status records between the merge base and HEAD: [{ status, path, to? }]. */
function changes(options, pathspec = []) {
  const fields = git(["diff", "-z", "--name-status", ...options, base, "HEAD", "--", ...pathspec]).split("\0");
  const out = [];
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) out.push({ status, path: fields[i++], to: fields[i++] });
    else out.push({ status, path: fields[i++] });
  }
  return out;
}

let migrationChanges;
let allPaths;
try {
  migrationChanges = changes(["--find-renames"], [DIR]);
  allPaths = changes(["--no-renames"]).map((c) => c.path);
} catch {
  fail("git could not list this branch's changes against main.");
}

const added = [];
for (const c of migrationChanges) {
  const name = c.path.slice(DIR.length);
  if (c.status === "A") {
    if (name.endsWith(".sql")) added.push(c.path);
    continue;
  }  const what = c.status.startsWith("R") ? `renames it to ${c.to}`
    : c.status === "M" ? "modifies it"
    : c.status === "D" ? "deletes it"
    : c.status === "T" ? "changes its type"
    : `changes it (git status ${c.status})`;
  refuse(`${c.path} exists on main and this branch ${what}. An applied migration is never edited, deleted or renamed: a fix is a NEW migration (${NEW_FILE}).`);
}

// ---- each added file ---------------------------------------------------------

/**
 * The SQL with every comment, string literal, quoted identifier and
 * dollar-quoted body replaced by spaces (newlines kept), so what is left is
 * what psql reads as statements, at the same offsets and line numbers.
 */
function mask(sql) {
  const out = sql.split("");
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  const isIdent = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end < 0 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      blank(i, j);
      i = j;
    } else if (ch === "'") {
      const escapes = /[eE]/.test(sql[i - 1] ?? "") && !isIdent(sql[i - 2]);
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      blank(i, j + 1);
      i = j + 1;
    } else if (ch === "\"") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\"") {
          if (sql[j + 1] === "\"") { j += 2; continue; }
          break;
        }
        j++;
      }
      blank(i, j + 1);
      i = j + 1;
    } else if (ch === "$" && !isIdent(sql[i - 1])) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (!tag) { i++; continue; }
      const close = sql.indexOf(tag, i + tag.length);
      const stop = close < 0 ? sql.length : close + tag.length;
      blank(i, stop);
      i = stop;
    } else {
      i++;
    }
  }
  return out.join("");
}

const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;

const TRANSACTION_CONTROL = /^(begin|commit|rollback|abort|end|start\s+transaction|savepoint|release|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i;
const CONTRACT = [
  ["DROP TABLE", /\bdrop\s+table\b/i],
  ["DROP COLUMN", /\bdrop\s+column\b/i],
  ["RENAME", /\brename\b/i],
];
const CONTRACT_REASON = /^[ \t]*--[ \t]*contract:[ \t]*\S/im;

function checkSql(file, sql) {
  const masked = mask(sql);

  // Statements as psql sends them, each with the offset of its first word. A
  // SQL-standard function body (BEGIN ATOMIC ... END) holds `;`s of its own:
  // its END closes the body, not a transaction.
  let atomic = false;
  let start = 0;
  for (let k = 0; k <= masked.length; k++) {
    if (k < masked.length && masked[k] !== ";") continue;
    const text = masked.slice(start, k);
    const lead = text.search(/\S/);
    if (lead >= 0) {
      const statement = text.slice(lead).trim();
      const at = start + lead;
      if (atomic) {
        if (/^end$/i.test(statement)) atomic = false;
      } else if (/\bbegin\s+atomic\b/i.test(statement) && !/^begin\s+atomic\b/i.test(statement)) {
        atomic = true;
      } else {
        const control = TRANSACTION_CONTROL.exec(statement)?.[0];
        if (control) {
          refuse(`${file}:${lineAt(sql, at)}: ${control.toUpperCase().replace(/\s+/g, " ")} at the top level. A migration runs inside ONE transaction that the runner opens; it must not open, commit or roll back its own.`);
        } else if (/^vacuum\b/i.test(statement)) {
          refuse(`${file}:${lineAt(sql, at)}: VACUUM cannot run inside a transaction, and every migration runs in one. Leave it to autovacuum, or ask for a hand-run step.`);
        }
      }
    }
    start = k + 1;
  }

  const concurrently = /\bconcurrently\b/i.exec(masked);
  if (concurrently) {
    refuse(`${file}:${lineAt(sql, concurrently.index)}: CONCURRENTLY cannot run inside a transaction, and every migration runs in one. Use the plain form (a plain CREATE INDEX takes a SHARE lock while it builds; see 0103's note), or ask for a hand-run step.`);
  }

  // psql starts a meta-command at ANY backslash outside a quoted string (a
  // trailing `\gset` included), not only at the start of a line; plain SQL
  // has no use for one there.
  const backslash = masked.indexOf("\\");
  if (backslash >= 0) {
    refuse(`${file}:${lineAt(sql, backslash)}: a backslash outside a string is a psql meta-command, and the runner applies migrations through psql. Write plain SQL.`);
  }

  for (let k = 0; k < masked.length; k++) {
    if (masked[k] !== ":" || masked[k - 1] === ":" || masked[k + 1] === ":") continue;
    if (/^['"]?bis_mig_/i.test(sql.slice(k + 1))) {
      refuse(`${file}:${lineAt(sql, k)}: ":bis_mig_" is the runner's own psql variable prefix, and psql would substitute it. Rename it.`);
      break;
    }
  }

  if (!CONTRACT_REASON.test(sql)) {
    for (const [kind, pattern] of CONTRACT) {
      const m = pattern.exec(masked);
      if (m) {
        refuse(`${file}:${lineAt(sql, m.index)}: ${kind} without a "-- contract: <why>" line. Production gets a migration BEFORE the app that needs it deploys, so the app on main must keep working once it is applied: say why in a "-- contract:" line (for example, nothing on main reads it any more).`);
      }
    }
  }
}

for (const file of added) {
  const name = file.slice(DIR.length);
  if (!NEW_NAME.test(name)) {
    refuse(`${file} is not named YYYYMMDDHHMMSS_slug.sql: numbers stopped at 0116, ${NEW_FILE}.`);
    continue;
  }
  let sql;
  try {
    sql = readFileSync(file, "utf8");
  } catch {
    fail(`${file} could not be read from the checkout.`);
  }
  checkSql(file, sql);
}

// ---- a migration and the pipeline, never both (owner decision Q6) ------------

const pipeline = allPaths.filter((p) => PIPELINE.some((re) => re.test(p)));
if (added.length > 0 && pipeline.length > 0) {
  refuse(`This branch adds a migration (${added.join(", ")}) AND changes the migration pipeline (${pipeline.join(", ")}). Owner decision 2026-11-13: a PR adds a migration OR changes the pipeline, never both. Split it into two PRs.`);
}

// ---- verdict ---------------------------------------------------------------

for (const message of errors) console.log(`::error::${message}`);
if (errors.length > 0) {
  console.log(`Migration plan: refused (${errors.length} problem(s), each named above).`);
  process.exit(1);
}
console.log(added.length === 0
  ? "Migration plan: this branch adds no migration file."
  : `Migration plan: this branch adds ${added.length} migration file(s): ${added.join(", ")}.`);
