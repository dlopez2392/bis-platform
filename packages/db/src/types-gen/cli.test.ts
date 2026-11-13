import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main, runCli, type Deps } from "./cli";

// What `types:gen` and `types:check` DO with a generated file, with the
// generator and the temp copy faked and the checked-in file read for real:
// the review (PR #360) changed the comparison to `driftReport(generated,
// generated)`, added a migration, and the check still said "matches".

const CHECKED_IN_PATH = fileURLToPath(new URL("../database.types.ts", import.meta.url));
const CHECKED_IN = readFileSync(CHECKED_IN_PATH, "utf8");
const DRIFTED = CHECKED_IN.replace("responses: number", "response_count: number");

function fake(generated: string) {
  const log = { out: [] as string[], err: [] as string[], writes: [] as string[], copies: [] as string[], urls: [] as string[] };
  const deps: Deps = {
    generateFrom: (url) => { log.urls.push(url); return generated; },
    generateFromMigrations: () => generated,
    readText: (path) => readFileSync(path, "utf8"),
    writeText: (path) => { log.writes.push(path); },
    saveGeneratedCopy: (text) => { log.copies.push(text); return "/tmp/bis-types-x/database.types.ts"; },
    out: (line) => log.out.push(line),
    err: (line) => log.err.push(line),
  };
  return { deps, log };
}

describe("main, check mode, against the real checked-in file", () => {
  it("exits 0 and saves no copy when the generated file is the checked-in one", () => {
    const { deps, log } = fake(CHECKED_IN);
    expect(main(["check"], {}, deps)).toBe(0);
    expect(log.out).toEqual(["types: packages/db/src/database.types.ts matches the schema"]);
    expect(log.copies).toEqual([]);
  });

  it("exits 1 on drift, naming types:gen and the saved copy of what was generated", () => {
    const { deps, log } = fake(DRIFTED);
    expect(main(["check"], { GITHUB_ACTIONS: "true" }, deps)).toBe(1);
    expect(log.err).toHaveLength(1);
    expect(log.err[0]).toMatch(/^::error::packages\/db\/src\/database\.types\.ts is not what the migrations generate/);
    expect(log.err[0]).toContain("`pnpm --filter @bis/db types:gen`");
    expect(log.err[0]).toContain("The generated file is at /tmp/bis-types-x/database.types.ts.");
    expect(log.copies).toEqual([DRIFTED]);
  });

  it("generates from the database the named variable holds", () => {
    const { deps, log } = fake(CHECKED_IN);
    expect(main(["check", "--db-url-env", "SUPABASE_DB_URL"], { SUPABASE_DB_URL: "postgresql://u:p@127.0.0.1:54322/postgres" }, deps)).toBe(0);
    expect(log.urls).toEqual(["postgresql://u:p@127.0.0.1:54322/postgres"]);
  });
});

describe("main, write mode", () => {
  it("writes the checked-in file's own path and exits 0", () => {
    const { deps, log } = fake(DRIFTED);
    expect(main(["write"], {}, deps)).toBe(0);
    expect(log.writes).toEqual([CHECKED_IN_PATH]);
  });
});

describe("main's errors", () => {
  it("exit 1 with the message redacted, never a throw", () => {
    const { deps, log } = fake(CHECKED_IN);
    deps.generateFrom = () => { throw new Error('types: docker exited 1: invalid URL "postgresql://postgres:hunter2@db:5432/x"'); };
    expect(main(["check", "--db-url-env", "U"], { U: "postgresql://a:b@127.0.0.1:1/x" }, deps)).toBe(1);
    expect(log.err.join("\n")).not.toContain("hunter2");
    expect(log.err.join("\n")).toContain("postgresql://***@db:5432/x");
  });

  it("exit 1 on bad arguments", () => {
    const { deps } = fake(CHECKED_IN);
    expect(main(["generate"], {}, deps)).toBe(1);
  });
});

describe("runCli: the process's exit code IS main's verdict", () => {
  it.each([[CHECKED_IN, 0], [DRIFTED, 1]] as const)("sets exitCode %#", (generated, code) => {
    const proc: { exitCode?: number } = {};
    runCli(["check"], {}, fake(generated).deps, proc);
    expect(proc.exitCode).toBe(code);
  });
});
