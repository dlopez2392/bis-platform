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
  const parts = ciDbUrlParts(dbUrl, ref);

  // Second layer: ask node-pg's own parser (ci:sql's and the db suite's
  // driver) what it would connect to. After the raw form above it always
  // agrees; it stays as the backstop for a pg quirk nobody has found. It says
  // nothing about the Supabase CLI's two parsers — the raw form is what
  // protects those (see `ciDbUrlParts`).
  assertPgResolvesTo(dbUrl, { user: parts.user, host: parts.host, port: parts.port, database: "postgres" });

  return { ref, url, dbUser: parts.user, dbHost: `${parts.host}:${parts.port}` };
}

/**
 * `require` only (or no sslmode). verify-ca / verify-full would promise a
 * check no path here performs consistently: ci:sql sets its own TLS options
 * (./sql.ts pgClientConfig, unverified), `db push` (pgconn) does not verify
 * even under verify-full, and `migration list` (the TS client) does and
 * would likely fail against the pooler's Supabase-root certificate
 * (re-review of PR #130). Refused until verification is real.
 */
const SSL_MODES = new Set(["require"]);

/** RFC 3986 unreserved characters, or a %XX escape. Nothing a parser splits on. */
const PASSWORD_SHAPE = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const POOLER_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com$/;

/**
 * The ONE raw form a CI DB URL may take, checked on the RAW string before any
 * parser sees it, and its parts:
 *
 *   postgresql://postgres.<ref>:<password>@<host>.pooler.supabase.com:<5432|6543>/postgres[?sslmode=<mode>]
 *
 * Why the raw string and not a parser's reading of it. There are three
 * readers, and they disagree (review and re-review of PR #130, the second
 * proven with the real CLI 2.109.1 against a local TLS listener):
 *   - `db push` hands the string to Go pgconn, which treats it as a URL only
 *     when it starts with EXACTLY lowercase `postgres://` or `postgresql://`;
 *     anything else is parsed as `key=value` pairs, so
 *     `POSTGRES://postgres.<ci>:a=b host=evil …@<pooler>…` connects to `evil`
 *     with the pairs smuggled in the password;
 *   - `migration list` uses a TS client (@effect/sql-pg), which with an
 *     upper-case scheme ignored the URL for PG* env vars and sent the whole
 *     URL, password included, as `options`;
 *   - node-pg (ci:sql, the db suite) honours `?host=`, `?user=`, `?port=`,
 *     `?options=` overrides and percent-decodes them.
 * A WHATWG `URL` agreed with none of them: it lower-cases the scheme,
 * resolves `/./` and `%2e%2e` segments, and keeps `%2E` in a host that pg
 * decodes. So: a lowercase scheme; the user exactly `postgres.<ref>`; a
 * password of unreserved characters or %XX (no raw space, `=`, `@`, `:`,
 * `/`, `?`, `#`, backslash or control character for a parser to split on); a
 * plain pooler host; an explicit port; the path exactly `/postgres`; and at
 * most the one `sslmode` parameter, once, and only `require`. (Both CLI paths
 * force TLS whatever sslmode says; `db push` does not verify the certificate
 * even under verify-full, `migration list` does. node-pg forces nothing,
 * which is why ci:sql sets `ssl` itself — ./sql.ts `pgClientConfig`.)
 *
 * Messages are constants or name the expected value; none repeats the input.
 * Exported for `pgClientConfig`, which needs the password this never returns
 * to anything that prints.
 */
export function ciDbUrlParts(dbUrl: string, ref: string): {
  user: string; password: string; host: string; port: number;
} {
  const scheme = /^(postgresql|postgres):\/\//.exec(dbUrl);
  if (!scheme) {
    throw new Error("SUPABASE_DB_URL is not a postgres connection string: it must start with postgresql:// or postgres://, in lowercase");
  }
  const rest = dbUrl.slice(scheme[0].length);

  // The LAST @: a raw @ in the password then lands in the password, where
  // the password check refuses it, instead of being read as the host.
  const at = rest.lastIndexOf("@");
  if (at === -1) throw new Error("SUPABASE_DB_URL is not a postgres connection string: it names no user");
  const userinfo = rest.slice(0, at);
  const colon = userinfo.indexOf(":");
  const user = colon === -1 ? userinfo : userinfo.slice(0, colon);
  const password = colon === -1 ? "" : userinfo.slice(colon + 1);

  // The Session pooler's user name carries the project ref; the host is
  // shared by every project in the region, so the user is the part that says
  // WHICH database this is.
  const expectedUser = `postgres.${ref}`;
  if (user !== expectedUser) throw new Error(`SUPABASE_DB_URL does not log in as ${expectedUser}`);
  if (!PASSWORD_SHAPE.test(password)) {
    throw new Error("SUPABASE_DB_URL password may contain only letters, digits, - . _ ~ and %XX escapes; percent-encode anything else");
  }

  const hostPart = rest.slice(at + 1);
  const end = hostPart.search(/[/?#]/);
  const hostPort = end === -1 ? hostPart : hostPart.slice(0, end);
  const tail = end === -1 ? "" : hostPart.slice(end);
  const portColon = hostPort.lastIndexOf(":");
  const host = portColon === -1 ? hostPort : hostPort.slice(0, portColon);
  const portText = portColon === -1 ? "" : hostPort.slice(portColon + 1);

  // The pooler, not the direct `db.<ref>.supabase.co` host: that host is
  // IPv6-only and GitHub's runners have no IPv6 (test/db.ts).
  if (!POOLER_HOST.test(host)) {
    throw new Error("SUPABASE_DB_URL is not a Supabase pooler host: use the Session pooler URI");
  }
  // Explicit, because every parser has its own default. 5432 is the session
  // pooler; 6543 the transaction pooler, the CI plan's fallback.
  if (portText !== "5432" && portText !== "6543") {
    throw new Error("SUPABASE_DB_URL port must be 5432 (session pooler) or 6543 (transaction pooler)");
  }

  const q = tail.indexOf("?");
  const path = q === -1 ? tail : tail.slice(0, q);
  if (path !== "/postgres") {
    throw new Error("SUPABASE_DB_URL must name the database postgres, as exactly /postgres");
  }
  if (q !== -1) {
    const query = tail.slice(q + 1);
    const params = new URLSearchParams(query);
    for (const key of new Set(params.keys())) {
      if (key !== "sslmode") {
        const shown = /^[a-z_]{1,32}$/.test(key) ? `"${key}"` : "one that is not shown";
        throw new Error(`SUPABASE_DB_URL may carry no query parameter but sslmode; found ${shown}`);
      }
    }
    if (params.getAll("sslmode").length > 1) {
      throw new Error("SUPABASE_DB_URL may carry sslmode at most once");
    }
    const mode = params.get("sslmode");
    if (mode === null || !SSL_MODES.has(mode) || query !== `sslmode=${mode}`) {
      throw new Error("SUPABASE_DB_URL sslmode may only be require (or absent): nothing here verifies the certificate yet");
    }
  }

  return { user, password, host, port: Number(portText) };
}

/**
 * Whether an environment variable may retarget a database client, or swap
 * the program that will be handed the DB URL. Matched case-insensitively:
 * Windows environment names are.
 *
 *   - PG*: every libpq-style client — Go pgconn, the CLI's TS client, node-pg
 *     — takes PGHOST, PGUSER, PGDATABASE, PGOPTIONS, PGAPPNAME, PGSSLMODE,
 *     PGPASSWORD … as defaults for whatever the config leaves unset.
 *   - The Supabase CLI 2.109.1 is THREE programs, and each earlier one
 *     launches the next by a path the environment can replace (re-review of
 *     PR #130; names grep-confirmed in the installed binaries):
 *       1. the npm shim (node_modules/supabase/dist/supabase.js:25) runs
 *          whatever SUPABASE_CLI_BINARY_OVERRIDE names instead of
 *       2. supabase.exe, the TypeScript CLI, which serves `migration list`
 *          itself (@effect/sql-pg) and runs whatever SUPABASE_GO_BINARY names
 *          instead of
 *       3. supabase-go.exe, which serves `db push` with pgconn.
 *     A replaced program receives `--db-url`, password included.
 *   - SUPABASE_CA_SKIP_VERIFY: read by both CLI binaries; it turns off the
 *     certificate checks the CLI does make.
 */
export function isConnectionOverride(key: string): boolean {
  return /^pg/i.test(key) || /^supabase_(cli_binary_override|go_binary|ca_skip_verify)$/i.test(key);
}

/** The environment a CI tool may hand a database client or the CLI: everything but `isConnectionOverride`. */
export function withoutConnectionOverrides(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || isConnectionOverride(key)) continue;
    out[key] = value;
  }
  return out;
}

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
