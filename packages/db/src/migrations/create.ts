import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newMigrationFileName } from "./names";

const HEADER =
  "-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration\n" +
  "-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.\n";

/**
 * Writes the next migration file into `dir` and returns its path. Refuses a
 * file that exists, and a second file with the same version (two files
 * created in one second): a version names exactly one migration.
 */
export function createMigrationFile(dir: string, slug: string, now: Date): string {
  const file = newMigrationFileName(slug, now);
  const version = file.slice(0, file.indexOf("_"));
  const clash = readdirSync(dir).find((f) => f.startsWith(`${version}_`));
  if (clash) throw new Error(`migration:new: ${clash} already exists with version ${version}; wait a second and run it again`);
  const path = join(dir, file);
  writeFileSync(path, HEADER, { flag: "wx" });
  return path;
}
