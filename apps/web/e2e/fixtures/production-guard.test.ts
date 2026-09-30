import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PRODUCTION_SUPABASE_REF, productionVariables, refuseProduction } from "./production-guard";

// Fake literal env only; nothing here connects. The password exists to prove
// it is never repeated.
const PROD = "tlbkbmlrfafquucsmsmm";
const CI_REF = "odnobiodsftffphuuosz";
const PASSWORD = "UnitTestOnlyPw4d9";

const ciEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${CI_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres.${CI_REF}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_UNIT_TEST_ONLY",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_UNIT_TEST_ONLY",
};

function refusal(env: Record<string, string | undefined>): string {
  try {
    refuseProduction(env, "The e2e suite");
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected refuseProduction to throw");
}

describe("refuseProduction (apps/web)", () => {
  it("carries the same production ref as packages/db's constant", () => {
    // One constant per package (apps/web cannot import packages/db/src/ci/target.ts:
    // @bis/db exports only "." and "./search-term"). This keeps the two in step.
    expect(PRODUCTION_SUPABASE_REF).toBe(PROD);
    const dbSource = readFileSync(path.resolve(__dirname, "../../../../packages/db/src/ci/target.ts"), "utf-8");
    expect(dbSource).toContain(`export const PRODUCTION_SUPABASE_REF = "${PRODUCTION_SUPABASE_REF}";`);
  });

  it("refuses production's API URL, naming the variable and the fix", () => {
    const message = refusal({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` });
    expect(message).toContain("The e2e suite refuses to run against production");
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toContain("docs/runbooks/ci-supabase-project.md, section 9");
  });

  it("refuses production's Session pooler URL without repeating it", () => {
    const dbUrl = `postgresql://postgres.${PROD}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    const message = refusal({ ...ciEnv, SUPABASE_DB_URL: dbUrl });
    expect(message).toContain("SUPABASE_DB_URL");
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(dbUrl);
    expect(message).not.toContain("pooler");
  });

  it("refuses production's direct database host", () => {
    expect(productionVariables({
      ...ciEnv, SUPABASE_DB_URL: `postgresql://postgres:${PASSWORD}@db.${PROD}.supabase.co:5432/postgres`,
    })).toEqual(["SUPABASE_DB_URL"]);
  });

  it("refuses the ref percent-encoded, once or twice", () => {
    const once = `https://%74${PROD.slice(1)}.supabase.co`;
    const twice = `https://%2574${PROD.slice(1)}.supabase.co`;
    expect(once).not.toContain(PROD);
    expect(productionVariables({ NEXT_PUBLIC_SUPABASE_URL: once })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(productionVariables({ NEXT_PUBLIC_SUPABASE_URL: twice })).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("refuses the ref in upper case, and reads variable names case-insensitively", () => {
    expect(productionVariables({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD.toUpperCase()}.supabase.co` }))
      .toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(productionVariables({ next_public_supabase_url: `https://${PROD}.supabase.co` }))
      .toEqual(["next_public_supabase_url"]);
  });

  it("allows the CI project", () => {
    expect(() => refuseProduction(ciEnv, "The e2e suite")).not.toThrow();
  });

  it("allows no credentials at all", () => {
    expect(() => refuseProduction({}, "The e2e suite")).not.toThrow();
  });

  it("ignores variables that cannot pick a database", () => {
    expect(productionVariables({ ...ciEnv, SOME_NOTE: `https://${PROD}.supabase.co` })).toEqual([]);
  });
});

/**
 * The web unit suite has exactly one way to reach a live database: a test
 * file that loads apps/web/.env.local itself (vitest does not put it in
 * process.env). Every such file must refuse production before it creates
 * anything. Scanned rather than listed, so a NEW live test that forgets the
 * guard fails here; comments are stripped first, so a guard mentioned only in
 * a comment does not count.
 */
describe("live web unit tests refuse production", () => {
  const SRC = path.resolve(__dirname, "../../src");

  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  const liveFiles = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => ({ rel: f.split(path.sep).join("/"), code: stripComments(readFileSync(path.join(SRC, f), "utf-8")) }))
    .filter(({ code }) => /from\s+"dotenv(?:\/config)?"|import\s+"dotenv\/config"/.test(code));

  it("finds the live files it exists to police (a scan that finds nothing proves nothing)", () => {
    expect(liveFiles.map((f) => f.rel)).toEqual(expect.arrayContaining([
      "app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts",
      "app/f/[publicId]/actions.returning-lead.test.ts",
    ]));
  });

  it("every one of them calls refuseProduction(process.env, …) (mutation: drop either call → FAILS naming the file)", () => {
    const unguarded = liveFiles
      .filter(({ code }) => !/\brefuseProduction\(\s*process\.env\s*,/.test(code))
      .map((f) => f.rel);
    expect(unguarded).toEqual([]);
  });
});
