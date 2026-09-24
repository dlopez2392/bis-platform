import { describe, it, expect } from "vitest";
import { PRODUCTION_SUPABASE_REF } from "../ci/target";
import { productionVariables, refuseProduction } from "./refuse-production";

// Fake literal env only. Nothing here connects, and none of these values is a
// real credential: the password below exists to prove it is never repeated.
const PROD = PRODUCTION_SUPABASE_REF;
const CI_REF = "odnobiodsftffphuuosz";
const PASSWORD = "UnitTestOnlyPw4d9";

const ciEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${CI_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres.${CI_REF}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_UNIT_TEST_ONLY",
  BIS_CI_SUPABASE_REF: CI_REF,
};

function refusal(env: Record<string, string | undefined>): string {
  try {
    refuseProduction(env, "The db suite");
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected refuseProduction to throw");
}

describe("refuseProduction", () => {
  it("refuses production's API URL, naming the variable and the fix", () => {
    const message = refusal({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` });
    expect(message).toContain("The db suite refuses to run against production");
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).not.toContain("SUPABASE_DB_URL");
    expect(message).toContain("docs/runbooks/ci-supabase-project.md, section 9");
  });

  it("refuses production's Session pooler URL (user postgres.<ref>) without repeating it", () => {
    const dbUrl = `postgresql://postgres.${PROD}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    const message = refusal({ ...ciEnv, SUPABASE_DB_URL: dbUrl });
    expect(message).toContain("SUPABASE_DB_URL");
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(dbUrl);
    expect(message).not.toContain("pooler");
  });

  it("refuses production's direct database host", () => {
    const message = refusal({
      ...ciEnv, SUPABASE_DB_URL: `postgresql://postgres:${PASSWORD}@db.${PROD}.supabase.co:5432/postgres`,
    });
    expect(message).toContain("SUPABASE_DB_URL");
    expect(message).not.toContain(PASSWORD);
  });

  it("refuses the ref percent-encoded, once or twice", () => {
    const once = `https://%74${PROD.slice(1)}.supabase.co`;
    const twice = `https://%2574${PROD.slice(1)}.supabase.co`;
    expect(once).not.toContain(PROD);
    expect(twice).not.toContain(PROD);
    expect(productionVariables({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: once })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(productionVariables({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: twice })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("refuses the ref in upper case", () => {
    expect(productionVariables({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD.toUpperCase()}.supabase.co` }))
      .toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("reads variable names case-insensitively, as Windows does", () => {
    expect(productionVariables({ supabase_db_url: `postgresql://postgres.${PROD}:x@h.pooler.supabase.com:5432/postgres` }))
      .toEqual(["supabase_db_url"]);
  });

  it("refuses a PG* override that names production (node-pg reads PGHOST and friends)", () => {
    expect(productionVariables({ ...ciEnv, PGHOST: `db.${PROD}.supabase.co` })).toEqual(["PGHOST"]);
  });

  it("names every variable that points at production, sorted", () => {
    expect(productionVariables({
      SUPABASE_DB_URL: `postgresql://postgres.${PROD}:x@h.pooler.supabase.com:5432/postgres`,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
    })).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL"]);
  });

  it("allows the CI project", () => {
    expect(() => refuseProduction(ciEnv, "The db suite")).not.toThrow();
    expect(productionVariables(ciEnv)).toEqual([]);
  });

  it("allows no credentials at all", () => {
    expect(() => refuseProduction({}, "The db suite")).not.toThrow();
  });

  it("ignores variables that cannot pick a database", () => {
    expect(productionVariables({ ...ciEnv, SOME_NOTE: `https://${PROD}.supabase.co` })).toEqual([]);
  });
});
