/**
 * The guard every CI-only write tool runs before it touches a database:
 * `db:push:ci` (./push.ts) and `ci:seed` (../ci-seed/run.ts).
 *
 * Why it exists. `db:push` used to push to whatever `SUPABASE_DB_URL` held,
 * and until the CI project exists that is production — which is why every
 * plan since M0 carried the words "never `db:push`". A rule a person has to
 * remember is not a control. This makes it mechanical: the tool names the ONE
 * project it may write (`BIS_CI_SUPABASE_REF`), refuses production's ref
 * outright, and refuses any URL that does not belong to the named project.
 *
 * All three of the API URL, the DB URL and the ref are required, even by a
 * tool that only uses one of the URLs. A half-switched env file (the API URL
 * moved to the CI project, the DB URL still production's) is exactly the
 * split brain the plan warns about, and a tool that ignored the unused half
 * would run happily inside it.
 *
 * Pure: no env reads, no network. The callers pass `process.env` values in, so
 * every refusal is unit-tested (./target.test.ts).
 */

/** Production's project ref. Never a CI target, under any spelling of the env. */
export const PRODUCTION_SUPABASE_REF = "tlbkbmlrfafquucsmsmm";

/** The env var that names the CI project. The only allowlist there is. */
export const CI_REF_ENV = "BIS_CI_SUPABASE_REF";

/**
 * ASSUMPTION about Supabase, not verified against its docs this session: a
 * project ref is 20 lowercase alphanumerics. Production's is 20 lowercase
 * letters. Digits are admitted so a ref that happens to carry one is not
 * refused on a guess; the length and the absence of anything else are what
 * stop a URL fragment or a padded value being taken for a ref.
 */
const REF_SHAPE = /^[a-z0-9]{20}$/;

/**
 * What a tool may print about where it is writing. Never the password: the DB
 * URL's credentials are split off here, so no caller can print them by
 * accident.
 */
export type CiTarget = { ref: string; url: string; dbUser: string; dbHost: string };

export function assertCiTarget(input: {
  ref: string | undefined; url: string | undefined; dbUrl: string | undefined;
}): CiTarget {
  const ref = input.ref?.trim() ?? "";
  if (!ref) {
    throw new Error(`${CI_REF_ENV} is not set: name the CI project's ref before running a CI-only tool`);
  }
  if (ref === PRODUCTION_SUPABASE_REF) {
    throw new Error(`${CI_REF_ENV} is production's ref (${PRODUCTION_SUPABASE_REF}); this tool never writes production`);
  }
  if (!REF_SHAPE.test(ref)) {
    // The value is NOT repeated: a secret pasted into the wrong variable is
    // how a key reaches a CI log. Its length is enough to see what went wrong.
    throw new Error(`${CI_REF_ENV} is not shaped like a Supabase project ref (20 lowercase letters or digits; got ${ref.length} characters)`);
  }

  const url = input.url?.trim() ?? "";
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (url.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL points at production; this tool never writes production");
  }
  const expectedUrl = `https://${ref}.supabase.co`;
  if (url !== expectedUrl) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not the CI project's API URL: expected ${expectedUrl}`);
  }

  const dbUrl = input.dbUrl?.trim() ?? "";
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set");
  if (dbUrl.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error("SUPABASE_DB_URL points at production; this tool never writes production");
  }
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error("SUPABASE_DB_URL is not a postgres connection string");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("SUPABASE_DB_URL is not a postgres connection string");
  }
  // The Session pooler's user name carries the project ref
  // (`postgres.<ref>`); the host is shared by every project in the region, so
  // the user is the part that says WHICH database this is.
  const expectedUser = `postgres.${ref}`;
  let dbUser: string;
  try {
    dbUser = decodeURIComponent(parsed.username);
  } catch {
    dbUser = parsed.username;
  }
  if (dbUser !== expectedUser) {
    throw new Error(`SUPABASE_DB_URL does not log in as ${expectedUser}`);
  }
  // The pooler, not the direct `db.<ref>.supabase.co` host: that host is
  // IPv6-only and GitHub's runners have no IPv6 (test/db.ts), so a direct URL
  // here works on one machine and fails on the other.
  if (!parsed.hostname.endsWith(".pooler.supabase.com")) {
    throw new Error("SUPABASE_DB_URL is not a Supabase pooler host: use the Session pooler URI");
  }

  return { ref, url, dbUser, dbHost: parsed.host };
}

/**
 * How a refusal may name a command-line argument: a plain `--flag` verbatim,
 * anything else not at all. An argument that is not a plain flag may be a DB
 * URL typed after the script name, password included.
 */
export function nameArgument(arg: string): string {
  return /^--[a-z][a-z-]*$/.test(arg) ? `argument "${arg}"` : "an argument that is not a plain flag (not shown: it may hold a secret)";
}

export function describeCiTarget(target: CiTarget): string {
  return [
    `CI project ${target.ref}`,
    `  api ${target.url}`,
    `  db  ${target.dbUser}@${target.dbHost}`,
  ].join("\n");
}
