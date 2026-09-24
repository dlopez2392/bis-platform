import { describe, it, expect } from "vitest";
import { assertCiTarget, assertPgResolvesTo, describeCiTarget, PRODUCTION_SUPABASE_REF } from "./target";

/**
 * The one guard between a CI-only write tool (`db:push:ci`, `ci:seed`) and the
 * Supabase project production runs on. Pure, so every refusal is proven here
 * with no credentials and no network.
 *
 * Every refusal is matched on its OWN message, not on "it threw". Several
 * checks overlap on purpose (a production ref also makes the URL wrong), so a
 * bare `toThrow()` would stay green with the specific check deleted and a later
 * one catching the case by accident. Pinning the message pins WHICH check fired.
 *
 * Refs below are fake: 20 lowercase letters, the shape of a real one.
 */
const CI_REF = "cicicicicicicicicici";
const OTHER_REF = "otherotherotherother";
const PROD = PRODUCTION_SUPABASE_REF;

const apiUrl = (ref: string) => `https://${ref}.supabase.co`;
const poolerUrl = (ref: string, password = "Secretpass123") =>
  `postgresql://postgres.${ref}:${password}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

const good = { ref: CI_REF, url: apiUrl(CI_REF), dbUrl: poolerUrl(CI_REF) };

describe("assertCiTarget", () => {
  it("pins the production ref it refuses", () => {
    expect(PROD).toBe("tlbkbmlrfafquucsmsmm");
  });

  it("refuses a missing CI ref", () => {
    expect(() => assertCiTarget({ ...good, ref: undefined })).toThrow(/BIS_CI_SUPABASE_REF is not set/);
  });

  it("refuses a blank CI ref", () => {
    expect(() => assertCiTarget({ ...good, ref: "   " })).toThrow(/BIS_CI_SUPABASE_REF is not set/);
  });

  it("refuses the production ref even when the URL and DB URL agree with it", () => {
    expect(() => assertCiTarget({ ref: PROD, url: apiUrl(PROD), dbUrl: poolerUrl(PROD) }))
      .toThrow(/BIS_CI_SUPABASE_REF is production's ref/);
  });

  it("refuses a CI ref that is not shaped like a project ref", () => {
    expect(() => assertCiTarget({ ...good, ref: "ci-project" })).toThrow(/not shaped like a Supabase project ref/);
  });

  /**
   * A value in the wrong variable is how secrets reach a log: a secret key
   * pasted into BIS_CI_SUPABASE_REF, or apps/web/.env.local's SUPABASE_DB_URL,
   * which holds an sb_secret_ key rather than a URL. No refusal may repeat
   * what it was given. (`new URL()` puts its input in its own error message,
   * which is why the DB URL parse is wrapped and rethrown with a constant.)
   */
  const SECRET = "sb_secret_DO_NOT_PRINT_xyz";
  const messageOf = (fn: () => unknown): string => {
    try { fn(); } catch (e) { return e instanceof Error ? e.message : String(e); }
    throw new Error("expected a refusal");
  };

  it("does not echo a malformed ref", () => {
    expect(messageOf(() => assertCiTarget({ ...good, ref: SECRET }))).not.toContain(SECRET);
  });

  it("does not echo an API URL it refuses", () => {
    expect(messageOf(() => assertCiTarget({ ...good, url: `https://x.supabase.co/${SECRET}` }))).not.toContain(SECRET);
  });

  it("does not echo a DB URL that is a secret key, not a URL", () => {
    expect(messageOf(() => assertCiTarget({ ...good, dbUrl: SECRET }))).not.toContain(SECRET);
  });

  it("does not echo a DB URL it refuses on the user", () => {
    const url = `postgresql://postgres.${OTHER_REF}:${SECRET}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    expect(messageOf(() => assertCiTarget({ ...good, dbUrl: url }))).not.toContain(SECRET);
  });

  it("refuses a missing API URL", () => {
    expect(() => assertCiTarget({ ...good, url: undefined })).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it("refuses production's API URL under a CI ref", () => {
    expect(() => assertCiTarget({ ...good, url: apiUrl(PROD) }))
      .toThrow(/NEXT_PUBLIC_SUPABASE_URL points at production/);
  });

  it("refuses an API URL for another project", () => {
    expect(() => assertCiTarget({ ...good, url: apiUrl(OTHER_REF) }))
      .toThrow(/NEXT_PUBLIC_SUPABASE_URL is not the CI project's API URL/);
  });

  it("refuses an API URL that only CONTAINS the CI project's URL", () => {
    expect(() => assertCiTarget({ ...good, url: `${apiUrl(CI_REF)}.evil.example` }))
      .toThrow(/NEXT_PUBLIC_SUPABASE_URL is not the CI project's API URL/);
  });

  it("refuses a missing DB URL", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: undefined })).toThrow(/SUPABASE_DB_URL is not set/);
  });

  it("refuses production's DB URL under a CI ref", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: poolerUrl(PROD) }))
      .toThrow(/SUPABASE_DB_URL points at production/);
  });

  it("refuses production's DIRECT DB host under a CI ref", () => {
    expect(() => assertCiTarget({
      ...good, dbUrl: `postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`,
    })).toThrow(/SUPABASE_DB_URL points at production/);
  });

  it("refuses a DB URL whose pooler user names another project", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: poolerUrl(OTHER_REF) }))
      .toThrow(/SUPABASE_DB_URL does not log in as postgres\.cicicicicicicicicici/);
  });

  it("refuses the CI project's direct host, which is not the session pooler", () => {
    expect(() => assertCiTarget({
      ...good, dbUrl: `postgresql://postgres.${CI_REF}:pw@db.${CI_REF}.supabase.co:5432/postgres`,
    })).toThrow(/SUPABASE_DB_URL is not a Supabase pooler host/);
  });

  it("refuses a DB URL that is not a postgres URL", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `https://postgres.${CI_REF}@aws-0-us-east-1.pooler.supabase.com` }))
      .toThrow(/SUPABASE_DB_URL is not a postgres connection string/);
  });

  it("refuses a DB URL that does not parse", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: "postgres.cicicicicicicicicici" }))
      .toThrow(/SUPABASE_DB_URL is not a postgres connection string/);
  });

  /**
   * The URL's authority is not the whole story. pg (pg-connection-string) and
   * the Supabase CLI both honour `?host=`, `?port=` and `?user=` query
   * overrides, and both percent-decode query values — so a URL whose
   * authority reads as the CI pooler can still dial another host, or log in
   * as production's user (`%74` is `t`). Found in review of PR #130: the guard
   * accepted such a URL and pg resolved `postgres.tlbkbmlrfafquucsmsmm`.
   */
  const pooler = `postgresql://postgres.${CI_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
  const PROD_PCT = `%74${PROD.slice(1)}`;

  it("refuses a ?user= override", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?user=postgres.${OTHER_REF}` }))
      .toThrow(/SUPABASE_DB_URL may carry no query parameter but sslmode; found "user"/);
  });

  it("refuses a ?host= override", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?host=evil.example` }))
      .toThrow(/SUPABASE_DB_URL may carry no query parameter but sslmode; found "host"/);
  });

  it("refuses a ?port= override", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?sslmode=require&port=6543` }))
      .toThrow(/SUPABASE_DB_URL may carry no query parameter but sslmode; found "port"/);
  });

  it("refuses ?options=, which pg passes to the server as session settings", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?options=-c%20default_transaction_read_only%3Doff` }))
      .toThrow(/SUPABASE_DB_URL may carry no query parameter but sslmode; found "options"/);
  });

  it("refuses production's ref percent-encoded in a query override", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?user=postgres.${PROD_PCT}` }))
      .toThrow(/SUPABASE_DB_URL points at production/);
  });

  it("refuses production's ref percent-encoded in the user name", () => {
    expect(() => assertCiTarget({
      ...good, dbUrl: `postgresql://postgres.${PROD_PCT}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    })).toThrow(/SUPABASE_DB_URL points at production/);
  });

  it("refuses an sslmode that turns TLS off", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?sslmode=disable` }))
      .toThrow(/SUPABASE_DB_URL sslmode must be require, verify-ca or verify-full/);
  });

  it("refuses a host carrying a percent-escape, which pg decodes and the URL parser does not", () => {
    // Probed: WHATWG keeps `aws-0-us-east-1%2Eevil.pooler.supabase.com`; pg
    // dials `aws-0-us-east-1.evil.pooler.supabase.com`.
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace("aws-0-us-east-1.pooler", "aws-0-us-east-1%2Eevil.pooler") }))
      .toThrow(/SUPABASE_DB_URL is not a Supabase pooler host/);
  });

  it("refuses a port that is not the pooler's", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace(":5432/", ":5433/") }))
      .toThrow(/SUPABASE_DB_URL port must be 5432 \(session pooler\) or 6543 \(transaction pooler\)/);
  });

  it("refuses a database other than postgres", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace(/\/postgres$/, "/template1") }))
      .toThrow(/SUPABASE_DB_URL must name the database postgres/);
  });

  it("accepts the session pooler with ?sslmode=require", () => {
    expect(assertCiTarget({ ...good, dbUrl: `${pooler}?sslmode=require` }).dbUser).toBe(`postgres.${CI_REF}`);
  });

  /**
   * ONE exact raw form, checked on the raw string before any parser (re-review
   * of PR #130). The Supabase CLI has two parsers: `db push` uses Go pgconn,
   * which treats the string as a URL only when it starts with EXACTLY
   * lowercase `postgres://` or `postgresql://` and otherwise parses
   * `key=value` pairs; `migration list` uses a TS client. A WHATWG parse
   * lowercases the scheme and resolves dot segments, so it agreed with
   * neither: the reviewer, with the real CLI against a local TLS listener, got
   * `POSTGRES://…:a=b host=evil …@pooler` past the guard and the CLI dialled
   * the smuggled host.
   */
  it("refuses an UPPER-case scheme", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace("postgresql://", "POSTGRESQL://") }))
      .toThrow(/must start with postgresql:\/\/ or postgres:\/\/, in lowercase/);
  });

  it("refuses a Mixed-case scheme", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace("postgresql://", "PostgreSQL://") }))
      .toThrow(/must start with postgresql:\/\/ or postgres:\/\/, in lowercase/);
  });

  it("refuses the reviewer's key=value smuggle under an upper-case scheme", () => {
    const smuggle = `POSTGRES://postgres.${CI_REF}:a=b host=evil port=5432 user=someone dbname=x@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    expect(() => assertCiTarget({ ...good, dbUrl: smuggle })).toThrow(/in lowercase/);
  });

  it.each([
    ["an =", "a=b"],
    ["a space", "a b"],
    ["an @", "a@b"],
    ["a :", "a:b"],
    ["a /", "a/b"],
    ["a ?", "a?b"],
    ["a #", "a#b"],
    ["no password at all", ""],
  ])("refuses %s raw in the password", (_label, password) => {
    const url = `postgresql://postgres.${CI_REF}:${password}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    expect(() => assertCiTarget({ ...good, dbUrl: url }))
      .toThrow(/SUPABASE_DB_URL password may contain only letters, digits, - \. _ ~ and %XX escapes/);
  });

  it("accepts a percent-escaped password", () => {
    expect(assertCiTarget({ ...good, dbUrl: pooler.replace(":pw@", ":p%40ss%3Dw0rd@") }).dbUser).toBe(`postgres.${CI_REF}`);
  });

  it.each([
    ["/./postgres"], ["/x/%2e%2e/postgres"], ["/x/../postgres"], ["/postgres/"], ["/postgres/."], ["/%70ostgres"],
  ])("refuses the dot-segment or escaped path %s", (path) => {
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace(/\/postgres$/, path) }))
      .toThrow(/SUPABASE_DB_URL must name the database postgres/);
  });

  it("refuses a fragment", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}#x` })).toThrow(/SUPABASE_DB_URL must name the database postgres/);
  });

  it("refuses sslmode given twice, even when both say require", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?sslmode=require&sslmode=require` }))
      .toThrow(/SUPABASE_DB_URL may carry sslmode at most once/);
  });

  it("refuses sslmode given twice when the second turns TLS off", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?sslmode=require&sslmode=disable` }))
      .toThrow(/SUPABASE_DB_URL may carry sslmode at most once/);
  });

  it("refuses a percent-escaped sslmode, which one parser decodes and another may not", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: `${pooler}?sslmode=%72equire` }))
      .toThrow(/SUPABASE_DB_URL sslmode must be require, verify-ca or verify-full/);
  });

  it("refuses a URL with no port (every parser would pick its own default)", () => {
    expect(() => assertCiTarget({ ...good, dbUrl: pooler.replace(":5432/", "/") }))
      .toThrow(/SUPABASE_DB_URL port must be 5432 \(session pooler\) or 6543 \(transaction pooler\)/);
  });

  it("accepts the postgres:// spelling of the scheme", () => {
    expect(assertCiTarget({ ...good, dbUrl: pooler.replace("postgresql://", "postgres://") }).dbHost)
      .toBe("aws-0-us-east-1.pooler.supabase.com:5432");
  });

  it("accepts the CI project and describes it without the password", () => {
    const target = assertCiTarget(good);
    expect(target).toEqual({
      ref: CI_REF,
      url: apiUrl(CI_REF),
      dbUser: `postgres.${CI_REF}`,
      dbHost: "aws-0-us-east-1.pooler.supabase.com:5432",
    });
    const text = describeCiTarget(target);
    expect(text).toContain(CI_REF);
    expect(text).toContain("aws-0-us-east-1.pooler.supabase.com:5432");
    expect(text).not.toContain("Secretpass123");
  });
});

/**
 * The second layer: whatever the URL reads as, ask pg's OWN parser what it
 * would connect to, and refuse unless that is the same user, host, port and
 * database. It catches a parser quirk the allowlist above did not anticipate;
 * these cases bypass the allowlist on purpose, to prove this layer alone.
 */
describe("assertPgResolvesTo", () => {
  const want = { user: `postgres.${CI_REF}`, host: "aws-0-us-east-1.pooler.supabase.com", port: 5432, database: "postgres" };
  const base = `postgresql://postgres.${CI_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

  it("passes when pg resolves exactly what the URL reads as", () => {
    expect(() => assertPgResolvesTo(base, want)).not.toThrow();
  });

  it("refuses when pg would dial another host", () => {
    expect(() => assertPgResolvesTo(`${base}?host=evil.example`, want)).toThrow(/pg would connect with a different host/);
  });

  it("refuses when pg would log in as another user", () => {
    expect(() => assertPgResolvesTo(`${base}?user=postgres.${OTHER_REF}`, want)).toThrow(/pg would connect with a different user/);
  });

  it("refuses when pg would use another port", () => {
    expect(() => assertPgResolvesTo(`${base}?port=6543`, want)).toThrow(/pg would connect with a different port/);
  });

  it("refuses when pg would open another database", () => {
    // pg ignores ?database= (the path wins; probed on pg 8.22), so the
    // difference has to come from the path itself.
    expect(() => assertPgResolvesTo(base.replace(/\/postgres$/, "/template1"), want))
      .toThrow(/pg would connect with a different database/);
  });

  it("does not echo the URL", () => {
    let message = "";
    try { assertPgResolvesTo(`${base.replace(":pw@", ":Secretpass123@")}?host=evil.example`, want); } catch (e) { message = (e as Error).message; }
    expect(message).not.toBe("");
    expect(message).not.toContain("Secretpass123");
    expect(message).not.toContain("evil.example");
  });
});
