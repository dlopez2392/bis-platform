import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newMigrationFileName } from "./names";

const HEADER =
  "-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration\n" +
  "-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.\n";

/**
 * Writes the next migration file into `dir` and returns its path. Refuses a
 * file that exists; a second file with the same version (two files created
 * in one second), since a version names exactly one migration; and a slug any
 * file already has, numbered or not (./names.ts: production records 61
 * legacy migrations by slug alone, and running this twice must not leave two
 * files a second apart).
 */
export function createMigrationFile(dir: string, slug: string, now: Date): string {
  const file = newMigrationFileName(slug, now);
  const version = file.slice(0, file.indexOf("_"));
  const existing = readdirSync(dir);
  const clash = existing.find((f) => f.startsWith(`${version}_`));
  if (clash) throw new Error(`migration:new: ${clash} already exists with version ${version}; wait a second and run it again`);
  const sameSlug = existing.find((f) => new RegExp(`^[0-9]+_${slug}\\.sql$`).test(f));
  if (sameSlug) throw new Error(`migration:new: ${sameSlug} already exists with the slug "${slug}"; choose another slug`);
  const path = join(dir, file);
  writeFileSync(path, HEADER, { flag: "wx" });
  return path;
}
