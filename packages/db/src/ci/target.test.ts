import { describe, it, expect } from "vitest";
import { assertCiTarget, describeCiTarget, PRODUCTION_SUPABASE_REF } from "./target";

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
