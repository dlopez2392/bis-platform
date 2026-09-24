import { describe, it, expect, vi, afterEach } from "vitest";

// No .env is loaded: the setup under test would otherwise read
// packages/db/.env, which on an unswitched machine names production.
vi.mock("dotenv/config", () => ({}));

import refuseProductionSetup from "./refuse-production.setup";
import dbSuiteConfig from "../../vitest.config";
import integrationConfig from "../../vitest.integration.config";
import { PRODUCTION_SUPABASE_REF } from "../ci/target";

const PROD = PRODUCTION_SUPABASE_REF;
const CI_REF = "odnobiodsftffphuuosz";

function globalSetupOf(config: { test?: { globalSetup?: string | string[] } }): string[] {
  const g = config.test?.globalSetup;
  return g === undefined ? [] : Array.isArray(g) ? g : [g];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the integration suite's production guard", () => {
  it("is the integration config's globalSetup (mutation: remove it → FAILS)", () => {
    expect(globalSetupOf(integrationConfig)).toContain("src/test/refuse-production.setup.ts");
  });

  it("the db suite's globalSetup is still the one that refuses before it sweeps", () => {
    expect(globalSetupOf(dbSuiteConfig)).toContain("src/test/global-setup.ts");
  });

  it("refuses production (mutation: drop the guard call → FAILS)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${PROD}.supabase.invalid`);
    expect(() => refuseProductionSetup()).toThrow(/The integration suite refuses to run against production: NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("allows the CI project", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${CI_REF}.supabase.invalid`);
    vi.stubEnv("SUPABASE_DB_URL", `postgresql://postgres.${CI_REF}:pw@pooler.invalid:5432/postgres`);
    expect(() => refuseProductionSetup()).not.toThrow();
  });

  it("allows no credentials (each integration test reports its own skip)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_DB_URL", undefined);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    expect(() => refuseProductionSetup()).not.toThrow();
  });
});
