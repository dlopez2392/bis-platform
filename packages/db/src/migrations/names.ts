/**
 * Migration file names (docs/superpowers/plans/2026-11-13-migration-pipeline.md, D1).
 *
 * Until 2026-11-13 every migration was numbered (0001..0116). Two branches
 * that both took the next number collided, so schema work queued behind
 * whichever merged first. The 116 numbered files keep their names, frozen;
 * every new file is `YYYYMMDDHHMMSS_slug.sql`, the UTC second it was created
 * (`pnpm --filter @bis/db migration:new <slug>`, ./new-run.ts).
 *
 * Ordering needs nothing new: every legacy name starts with 0 and every
 * timestamped one with 2, so file-name order (what `supabase db push` and the
 * types generator use), numeric order and Postgres' `order by version` on the
 * text column all put the legacy files first, then the new ones by time.
 *
 * A file's history row is `(version, name)`: the digits before the first
 * underscore and the slug after it, which is what the CLI records. The slug
 * starts with a letter so that a stem can never be mistaken for a version
 * followed by more digits (`parity/migration-history.sql` tells a name that
 * already carries its number from one that does not by `^[0-9]+_`).
 *
 * Pure: no file system, no clock. ./create.ts and ./new-run.ts do the I/O.
 */

/** The last numbered migration. No numbered file after it is accepted. */
export const LEGACY_LAST = 116;

/**
 * The first second of timestamped names (the switch, 2026-11-13 UTC). An
 * earlier version is a typo or a copied name, and would sort among, or ahead
 * of, migrations that production already has.
 */
export const TIMESTAMPED_FROM = "20261113000000";

/** How far ahead of the clock a timestamp may be (a machine whose clock runs fast). */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

const FILE = /^([0-9]+)_(.*)\.sql$/;
const SLUG = /^[a-z][a-z0-9_]*$/;
const NEW_FILE_HINT = "create new migrations with `pnpm --filter @bis/db migration:new <slug>`";

export type MigrationFile = {
  file: string;
  stem: string;
  version: string;
  name: string;
  kind: "legacy" | "timestamped";
};

/** The UTC instant a 14-digit version names, or null when it is not a real date and time. */
function timestampOf(version: string): Date | null {
  const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((at, i) => Number(version.slice(at, at + (i === 0 ? 4 : 2))));
  const date = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
  const roundTrip = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return roundTrip === version ? date : null;
}

export function parseMigrationFile(file: string): MigrationFile | { error: string } {
  const m = FILE.exec(file);
  if (!m) return { error: `${file} is not named <version>_<slug>.sql` };
  const [, version, name] = m as unknown as [string, string, string];
  if (!SLUG.test(name)) {
    return { error: `${file}: the slug "${name}" must be lower-case letters, digits and underscores, starting with a letter` };
  }
  const stem = file.slice(0, -".sql".length);
  if (version.length === 4) {
    const n = Number(version);
    if (n < 1 || n > LEGACY_LAST) {
      return { error: `${file} is a new numbered migration; numbers stopped at ${String(LEGACY_LAST).padStart(4, "0")}: ${NEW_FILE_HINT}` };
    }
    return { file, stem, version, name, kind: "legacy" };
  }
  if (version.length !== 14) {
    return { error: `${file}: a new migration's version is a 14-digit UTC timestamp (YYYYMMDDHHMMSS): ${NEW_FILE_HINT}` };
  }
  if (!timestampOf(version)) return { error: `${file}: ${version} is not a real UTC date and time` };
  if (version < TIMESTAMPED_FROM) {
    return { error: `${file}: ${version} is before ${TIMESTAMPED_FROM}, when timestamped names began: ${NEW_FILE_HINT}` };
  }
  return { file, stem, version, name, kind: "timestamped" };
}

/**
 * Every problem with the migrations directory's listing, one sentence each;
 * empty when it is sound. Files that are not .sql are ignored (the CLI skips
 * them too).
 */
export function checkMigrationDirectory(files: readonly string[], now: Date): string[] {
  const problems: string[] = [];
  const byVersion = new Map<string, string[]>();
  const bySlug = new Map<string, MigrationFile[]>();
  for (const file of files.filter((f) => f.endsWith(".sql"))) {
    const parsed = parseMigrationFile(file);
    if ("error" in parsed) {
      problems.push(parsed.error);
      continue;
    }
    byVersion.set(parsed.version, [...(byVersion.get(parsed.version) ?? []), file]);
    bySlug.set(parsed.name, [...(bySlug.get(parsed.name) ?? []), parsed]);
    if (parsed.kind === "timestamped" && timestampOf(parsed.version)!.getTime() > now.getTime() + FUTURE_SLACK_MS) {
      problems.push(`${file}: its timestamp is more than a day in the future; ${NEW_FILE_HINT}`);
    }
  }
  for (const [version, named] of byVersion) {
    if (named.length > 1) problems.push(`version ${version} is used more than once: ${named.join(", ")}`);
  }
  // A timestamped file's slug is unique across the whole directory. Production
  // records 61 legacy migrations (0032, 0042-0045, 0060-0115) by slug alone,
  // so a reused slug would make those rows ambiguous. Two LEGACY files that
  // already share one (0026 and 0047, automations_b) are grandfathered.
  for (const [slug, sharing] of bySlug) {
    if (sharing.length > 1 && sharing.some((m) => m.kind === "timestamped")) {
      problems.push(`the slug "${slug}" is used more than once (${sharing.map((m) => m.file).join(", ")}): a new migration's slug must be unique`);
    }
  }
  for (let n = 1; n <= LEGACY_LAST; n++) {
    const version = String(n).padStart(4, "0");
    if (!byVersion.has(version)) {
      problems.push(`legacy migration ${version} is missing: an applied migration is never deleted or renamed`);
    }
  }
  return problems;
}

/** The file name `migration:new <slug>` creates at `now`. */
export function newMigrationFileName(slug: string, now: Date): string {
  if (!SLUG.test(slug)) {
    throw new Error(`migration:new: the slug "${slug}" must be lower-case letters, digits and underscores, starting with a letter`);
  }
  return `${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}_${slug}.sql`;
}
