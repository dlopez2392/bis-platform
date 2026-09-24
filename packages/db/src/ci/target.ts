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
 * every refusal is unit-tested (./target.test.ts). It does construct a `pg`
 * Client, to ask pg's parser what a URL resolves to; that never connects.
 */
import { Client } from "pg";

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
  if (mentionsProduction(url)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL points at production; this tool never writes production");
  }
  const expectedUrl = `https://${ref}.supabase.co`;
  if (url !== expectedUrl) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not the CI project's API URL: expected ${expectedUrl}`);
  }

  const dbUrl = input.dbUrl?.trim() ?? "";
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set");
  if (mentionsProduction(dbUrl)) {
    throw new Error("SUPABASE_DB_URL points at production; this tool never writes production");
  }
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    // Constant message on purpose: `new URL()`'s own error carries its input.
    throw new Error("SUPABASE_DB_URL is not a postgres connection string");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("SUPABASE_DB_URL is not a postgres connection string");
  }

  // The authority is not the whole story. pg (pg-connection-string) and the
  // Supabase CLI both let a query parameter override it — `?host=`, `?port=`,
  // `?user=`, `?database=`, `?options=` and more — and both percent-decode
  // the value, so a URL whose authority reads as the CI pooler could dial
  // another host or log in as another project's user (review of PR #130).
  // Rather than enumerate what each parser honours, refuse every parameter
  // but the one a Supabase pooler URI carries. The key is named only when it
  // is a plain word, never the value.
  for (const key of new Set(parsed.searchParams.keys())) {
    if (key !== "sslmode") {
      const shown = /^[a-z_]{1,32}$/.test(key) ? `"${key}"` : "one that is not shown";
      throw new Error(`SUPABASE_DB_URL may carry no query parameter but sslmode; found ${shown}`);
    }
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode !== null && !SSL_MODES.has(sslmode)) {
    throw new Error("SUPABASE_DB_URL sslmode must be require, verify-ca or verify-full");
  }

  // The Session pooler's user name carries the project ref
  // (`postgres.<ref>`); the host is shared by every project in the region, so
  // the user is the part that says WHICH database this is.
  const expectedUser = `postgres.${ref}`;
  const dbUser = decodeOnce(parsed.username);
  if (dbUser !== expectedUser) {
    throw new Error(`SUPABASE_DB_URL does not log in as ${expectedUser}`);
  }
  // The pooler, not the direct `db.<ref>.supabase.co` host: that host is
  // IPv6-only and GitHub's runners have no IPv6 (test/db.ts), so a direct URL
  // here works on one machine and fails on the other.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(parsed.hostname)) {
    throw new Error("SUPABASE_DB_URL is not a Supabase pooler host: use the Session pooler URI");
  }
  // 5432 is the session pooler (and pg's default when the URL names none);
  // 6543 the transaction pooler, which the CI plan keeps as the fallback if
  // the session pool runs out of clients.
  const port = parsed.port === "" ? 5432 : Number(parsed.port);
  if (port !== 5432 && port !== 6543) {
    throw new Error("SUPABASE_DB_URL port must be 5432 (session pooler) or 6543 (transaction pooler)");
  }
  if (parsed.pathname !== "/postgres") {
    throw new Error("SUPABASE_DB_URL must name the database postgres");
  }

  // Second layer: whatever the URL reads as above, ask pg's own parser what it
  // would connect to. Anything the allowlist did not anticipate shows up here
  // as a mismatch instead of as a connection to the wrong database.
  assertPgResolvesTo(dbUrl, { user: expectedUser, host: parsed.hostname, port, database: "postgres" });

  return { ref, url, dbUser, dbHost: parsed.host };
}

const SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

function decodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Production's ref anywhere in the string, raw OR percent-decoded (up to
 * three rounds, until it stops changing). `%74lbkb…` is production's ref to
 * every parser that decodes, so a search of the raw bytes alone missed it.
 */
function mentionsProduction(value: string): boolean {
  let current = value.toLowerCase();
  for (let round = 0; round < 4; round++) {
    if (current.includes(PRODUCTION_SUPABASE_REF)) return true;
    const next = decodeOnce(current).toLowerCase();
    if (next === current) return false;
    current = next;
  }
  return current.includes(PRODUCTION_SUPABASE_REF);
}

/**
 * Throws unless `pg` — the driver ci:sql and the db suite connect with —
 * resolves `dbUrl` to exactly `want`. Builds a `Client` and reads its
 * `connectionParameters`; constructing a Client does not connect. Every
 * message names only the FIELD that differs: the URL and the value pg
 * resolved stay out of it.
 *
 * Fails closed if a future pg stops exposing `connectionParameters`.
 */
export function assertPgResolvesTo(
  dbUrl: string, want: { user: string; host: string; port: number; database: string },
): void {
  let resolved: { user?: unknown; host?: unknown; port?: unknown; database?: unknown } | undefined;
  try {
    const client = new Client({ connectionString: dbUrl });
    resolved = (client as unknown as { connectionParameters?: typeof resolved }).connectionParameters;
  } catch {
    throw new Error("SUPABASE_DB_URL could not be read by pg");
  }
  if (!resolved) throw new Error("SUPABASE_DB_URL could not be checked: pg exposes no connectionParameters");
  const fields: [keyof typeof want, unknown][] = [
    ["user", resolved.user], ["host", resolved.host], ["port", Number(resolved.port)], ["database", resolved.database],
  ];
  for (const [field, value] of fields) {
    if (value !== want[field]) {
      throw new Error(`SUPABASE_DB_URL: pg would connect with a different ${field} than the URL names; refusing`);
    }
  }
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
