import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigrationFile } from "./create";

// `pnpm --filter @bis/db migration:new <slug>` (./new-run.ts) writes the next
// migration file. Run here against a scratch directory, never the real one.

const NOW = new Date(Date.UTC(2026, 10, 13, 18, 30, 5));
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "migration-new-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createMigrationFile", () => {
  it("creates <UTC timestamp>_<slug>.sql in the directory and returns its path", () => {
    const path = createMigrationFile(dir, "work_queue", NOW);
    expect(path).toBe(join(dir, "20261113183005_work_queue.sql"));
    expect(readdirSync(dir)).toEqual(["20261113183005_work_queue.sql"]);
  });

  it("starts the file with the append-only rule, so the author sees it before writing", () => {
    const text = readFileSync(createMigrationFile(dir, "x", NOW), "utf8");
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/new migration/i);
  });

  it("never overwrites an existing file", () => {
    writeFileSync(join(dir, "20261113183005_x.sql"), "select 1;\n");
    expect(() => createMigrationFile(dir, "x", NOW)).toThrow(/exists/);
    expect(readFileSync(join(dir, "20261113183005_x.sql"), "utf8")).toBe("select 1;\n");
  });

  it("refuses a bad slug and writes nothing", () => {
    expect(() => createMigrationFile(dir, "Bad-Slug", NOW)).toThrow(/slug/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a second file in the same second with another slug: one version, one file", () => {
    createMigrationFile(dir, "a", NOW);
    expect(() => createMigrationFile(dir, "b", NOW)).toThrow(/20261113183005/);
    expect(existsSync(join(dir, "20261113183005_b.sql"))).toBe(false);
  });
});
