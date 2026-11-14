import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .github/scripts/ci-gate.sh is the whole of the two REQUIRED checks since
// 2026-11-12. The ruleset on main requires check runs named exactly `verify`
// and `e2e`, and it cannot be changed from here, so when each was split into
// parts that run in parallel (verify-db and verify-app; e2e-migrations and
// four e2e-shard runners), `verify` and `e2e` became small jobs that `need`
// their parts, run `if: always()`, and pass only when this script says every
// part SUCCEEDED. GitHub reports a skipped required check as passing, so the
// one thing this script must never do is read anything but `success` as
// green: not `skipped`, not `cancelled`, not an empty string from a misspelt
// `needs.<id>.result`. The parts never skip a whole job (a docs-only push
// skips their STEPS and still ends `success`), so no exception is needed.
//
// Run for real, through bash, with nothing but the env each case hands it.

const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/ci-gate.sh", import.meta.url)).replace(/\\/g, "/");

/** Git for Windows' bash (never WSL's launcher), or plain bash elsewhere. No bash is a FAILURE. */
function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const candidates = [
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).map((b) => path.join(b!, "Git")),
    path.resolve(execPath, "..", "..", ".."),
  ].map((r) => path.join(r, "usr", "bin", "bash.exe"));
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`No Git for Windows bash found (looked at: ${candidates.join(", ")})`);
  return found;
}
const BASH = bashExecutable();

function gate(args: string[], env: Record<string, string>) {
  const r = spawnSync(BASH, [SCRIPT, ...args], {
    encoding: "utf8",
    // Nothing but PATH and what the case hands it (NODE_ENV only because
    // Next's ProcessEnv type requires it; the script never reads it).
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe("ci-gate.sh: a required check is green only when every part it names succeeded", () => {
  it("passes when every named part's result is success, naming each", () => {
    const r = gate(["VERIFY_DB", "VERIFY_APP"], { VERIFY_DB: "success", VERIFY_APP: "success" });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/VERIFY_DB: success/);
    expect(r.output).toMatch(/VERIFY_APP: success/);
    expect(r.output).not.toContain("::error::");
  });

  it.each(["failure", "cancelled", "skipped"])("refuses a part whose result is %s, naming it (mutation: accept `skipped` → FAILS)", (result) => {
    const r = gate(["E2E_MIGRATIONS", "E2E_SHARD"], { E2E_MIGRATIONS: "success", E2E_SHARD: result });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(new RegExp(`::error::E2E_SHARD is ${result}`));
  });

  it("refuses a part whose result is empty or unset: a misspelt needs.<id>.result is an empty string, never a pass", () => {
    const empty = gate(["VERIFY_DB", "VERIFY_APP"], { VERIFY_DB: "success", VERIFY_APP: "" });
    expect(empty.status, empty.output).toBe(1);
    expect(empty.output).toMatch(/::error::VERIFY_APP is empty or unset/);
    const unset = gate(["VERIFY_DB", "VERIFY_APP"], { VERIFY_DB: "success" });
    expect(unset.status, unset.output).toBe(1);
    expect(unset.output).toMatch(/::error::VERIFY_APP is empty or unset/);
  });

  it("names EVERY part that did not succeed, not only the first", () => {
    const r = gate(["A_RESULT", "B_RESULT", "C_RESULT"], { A_RESULT: "failure", B_RESULT: "success", C_RESULT: "cancelled" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::A_RESULT is failure/);
    expect(r.output).toMatch(/::error::C_RESULT is cancelled/);
  });

  it("refuses to pass with nothing to check (mutation: an empty arg list exits 0 → FAILS)", () => {
    const r = gate([], {});
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::/);
  });

  it("refuses an argument that is not an environment variable name, rather than reading something else", () => {
    const r = gate(["needs.verify-db.result"], {});
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::.*not a variable name/);
  });
});

// NAME@DUE (2026-11-13, migration pipeline PR 4): a part that runs only when
// it is due. migrations-bis-ci applies to bis-ci only for a branch that adds a
// migration (and checks bis-ci on main); for every other push it is skipped,
// so a PR with no migration neither waits for it nor reaches bis-ci. DUE names
// an env variable: non-empty means the part had to run and succeed; empty
// means it had to be SKIPPED, and anything else means the job's `if` and the
// gate disagree, which is a red, not a guess.
describe("ci-gate.sh NAME@DUE: a part that must succeed when due and be skipped when not", () => {
  it("passes a due part that succeeded", () => {
    const r = gate(["BIS_CI@DUE"], { BIS_CI: "success", DUE: "packages/db/supabase/migrations/20261114093000_a.sql" });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/BIS_CI: success/);
  });

  it.each(["skipped", "failure", "cancelled", ""])("refuses a due part whose result is '%s', naming it (mutation: accept `skipped` when due → FAILS)", (result) => {
    const r = gate(["BIS_CI@DUE"], { BIS_CI: result, DUE: "yes" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::BIS_CI /);
  });

  it("passes a part that was not due and was skipped, saying so", () => {
    const r = gate(["BIS_CI@DUE"], { BIS_CI: "skipped", DUE: "" });
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/BIS_CI: skipped, as it should be: not due/);
  });

  it.each(["success", "failure", "cancelled", ""])("refuses a part that was not due but whose result is '%s': the job's `if` and the gate disagree (mutation: pass anything when not due → FAILS)", (result) => {
    const r = gate(["BIS_CI@DUE"], { BIS_CI: result, DUE: "" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::BIS_CI /);
  });

  it("still requires every plain part beside it", () => {
    const r = gate(["E2E_SHARD", "BIS_CI@DUE"], { E2E_SHARD: "failure", BIS_CI: "skipped", DUE: "" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::E2E_SHARD is failure/);
  });

  it("refuses a DUE that is not a variable name", () => {
    const r = gate(["BIS_CI@needs.x"], { BIS_CI: "skipped" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::.*not a variable name/);
  });
});

// PR 5 (2026-11-13): the e2e gate as ci.yml actually invokes it. The argument
// list is READ from ci.yml's e2e job, so these cases hold the workflow and the
// script together: a branch that adds migrations is green only when
// migrations-production succeeded; a branch with none needs it skipped.
describe("the e2e gate, with ci.yml's own arguments, holds a migration PR until production has its files", () => {
  const ci = fs.readFileSync(fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url)), "utf8");
  const at = ci.indexOf("\n  e2e:\n");
  const runLine = ci.slice(at).split("\n").find((l) => l.trim().startsWith("run: bash .github/scripts/ci-gate.sh"))!;
  const args = runLine.trim().replace("run: bash .github/scripts/ci-gate.sh ", "").split(" ");
  const ok = { E2E_SHARD: "success", MIGRATIONS_PLAN: "success" };

  it("names migrations-production as a due part (mutation: drop it from the gate's arguments → FAILS)", () => {
    expect(args).toContain("MIGRATIONS_PRODUCTION@PRODUCTION_DUE");
  });

  it("new migration files + production SKIPPED (the click never came, or bis-ci failed) → red (mutation: let the gate accept a skipped production job → FAILS)", () => {
    const r = gate(args, { ...ok, MIGRATIONS_BIS_CI: "success", BIS_CI_DUE: "due", MIGRATIONS_PRODUCTION: "skipped", PRODUCTION_DUE: "due" });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/::error::MIGRATIONS_PRODUCTION is skipped/);
  });

  it.each(["failure", "cancelled"])("new migration files + production %s (an apply or parity failure) → red", (result) => {
    const r = gate(args, { ...ok, MIGRATIONS_BIS_CI: "success", BIS_CI_DUE: "due", MIGRATIONS_PRODUCTION: result, PRODUCTION_DUE: "due" });
    expect(r.status, r.output).toBe(1);
  });

  it("new migration files + production SUCCESS → green", () => {
    const r = gate(args, { ...ok, MIGRATIONS_BIS_CI: "success", BIS_CI_DUE: "due", MIGRATIONS_PRODUCTION: "success", PRODUCTION_DUE: "due" });
    expect(r.status, r.output).toBe(0);
  });

  it("no migration files: bis-ci and production both skipped → green, and production touched → red", () => {
    const base = { ...ok, MIGRATIONS_BIS_CI: "skipped", BIS_CI_DUE: "", PRODUCTION_DUE: "" };
    expect(gate(args, { ...base, MIGRATIONS_PRODUCTION: "skipped" }).status).toBe(0);
    expect(gate(args, { ...base, MIGRATIONS_PRODUCTION: "success" }).status).toBe(1);
  });

  it("main: bis-ci checks, production is never due and must be skipped → green", () => {
    const r = gate(args, { ...ok, MIGRATIONS_BIS_CI: "success", BIS_CI_DUE: "due", MIGRATIONS_PRODUCTION: "skipped", PRODUCTION_DUE: "" });
    expect(r.status, r.output).toBe(0);
  });
});
