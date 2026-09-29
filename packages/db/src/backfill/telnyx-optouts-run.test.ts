import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * The CLI (`telnyx-optouts-run.ts`) is exercised as an actual subprocess —
 * exactly how `pnpm --filter @bis/db backfill:telnyx-optouts` runs it — so
 * these tests see the real stdout/stderr/exit code a human operator would,
 * and never trip the script's own top-level `run(process.argv.slice(2))`
 * side effect that firing on `import` would cause. Spawning `tsx` is slow
 * (it must compile the module graph each time), so this file gets a longer
 * timeout than vitest's 5 s default.
 */
vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const SCRIPT = fileURLToPath(new URL("./telnyx-optouts-run.ts", import.meta.url));
const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url)); // packages/db

const DIGIT_RUN = /\d{7,}/;
const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT, ...args], {
    cwd: PKG_ROOT, encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "telnyx-optouts-run-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("telnyx-optouts-run: malformed JSON never echoes a customer's digits back (review I1)", () => {
  it("a malformed opt-outs file refuses with a plain message, never V8's own quoted snippet of the input (mutation: let JSON.parse's own SyntaxError escape → FAILS)", () => {
    withTmp((dir) => {
      const optoutsPath = join(dir, "optouts.json");
      const ownersPath = join(dir, "owners.json");
      // Unquoted "+..." value: valid-looking JSON that fails to parse, and
      // whose V8 SyntaxError (Node 20+) quotes a snippet of the input that
      // carries most of the customer's own digits.
      writeFileSync(optoutsPath, '[{"to":"+15559876543","from":+15550001111}]');
      writeFileSync(ownersPath, JSON.stringify([{ e164: "+15550001111", account_id: OWNER_ID, status: "active" }]));
      const r = runCli([optoutsPath, ownersPath]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/not valid JSON/);
      expect(r.stderr).not.toMatch(DIGIT_RUN);
    });
  });

  it("a malformed owners file refuses with a plain message, never V8's own quoted snippet of the input (mutation: let JSON.parse's own SyntaxError escape → FAILS)", () => {
    withTmp((dir) => {
      const optoutsPath = join(dir, "optouts.json");
      const ownersPath = join(dir, "owners.json");
      writeFileSync(optoutsPath, JSON.stringify([
        { from: "+15550001111", to: "+15559876543", messaging_profile_id: null, keyword: "STOP", created_at: "2026-01-01T00:00:00Z" },
      ]));
      writeFileSync(ownersPath, `[{"e164":+15550001111,"account_id":"${OWNER_ID}"}]`);
      const r = runCli([optoutsPath, ownersPath]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/not valid JSON/);
      expect(r.stderr).not.toMatch(DIGIT_RUN);
    });
  });
});

describe("telnyx-optouts-run: --emit-sql refuses a reversed from/to instead of silently writing nothing (spec's own review I2/M1 reasoning)", () => {
  it("a reversed from/to exits non-zero under --emit-sql and writes no file (mutation: return early on an empty plan before checking toMatchesOwners → FAILS)", () => {
    withTmp((dir) => {
      const optoutsPath = join(dir, "optouts.json");
      const ownersPath = join(dir, "owners.json");
      const outPath = join(dir, "out.sql");
      // "to" (the record's customer field) is one of OUR OWN numbers: a
      // reversed reading. "from" matches no owner, so toAppend is EMPTY —
      // the early "nothing to write" return must not swallow this refusal.
      writeFileSync(optoutsPath, JSON.stringify([
        { from: "+15559876543", to: "+15550001111", messaging_profile_id: null, keyword: "STOP", created_at: "2026-01-01T00:00:00Z" },
      ]));
      writeFileSync(ownersPath, JSON.stringify([{ e164: "+15550001111", account_id: OWNER_ID, status: "active" }]));
      const r = runCli([optoutsPath, ownersPath, "--emit-sql", outPath]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/reversed/);
      expect(existsSync(outPath)).toBe(false);
    });
  });

  it("a normal (non-reversed) run still writes the file and exits 0 (the positive control proving the harness runs the CLI at all)", () => {
    withTmp((dir) => {
      const optoutsPath = join(dir, "optouts.json");
      const ownersPath = join(dir, "owners.json");
      const outPath = join(dir, "out.sql");
      writeFileSync(optoutsPath, JSON.stringify([
        { from: "+15550001111", to: "+15559876543", messaging_profile_id: null, keyword: "STOP", created_at: "2026-01-01T00:00:00Z" },
      ]));
      writeFileSync(ownersPath, JSON.stringify([{ e164: "+15550001111", account_id: OWNER_ID, status: "active" }]));
      const r = runCli([optoutsPath, ownersPath, "--emit-sql", outPath]);
      expect(r.status).toBe(0);
      expect(existsSync(outPath)).toBe(true);
    });
  });
});
