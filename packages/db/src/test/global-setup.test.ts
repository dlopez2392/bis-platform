import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Everything global-setup.ts reaches is replaced, so no path through this
// file can connect anywhere: no .env is loaded, no client is built, nothing
// is swept. The hosts below are `.invalid` (RFC 6761) on top of that.
vi.mock("dotenv/config", () => ({}));
vi.mock("../service", () => ({ serviceDb: vi.fn(() => ({ fake: true })) }));
vi.mock("./sweep-fixtures", () => ({ sweepAbandonedFixtures: vi.fn(async () => []) }));

import setup from "./global-setup";
import { serviceDb } from "../service";
import { sweepAbandonedFixtures } from "./sweep-fixtures";
import { PRODUCTION_SUPABASE_REF } from "../ci/target";

const PROD = PRODUCTION_SUPABASE_REF;
const CI_REF = "odnobiodsftffphuuosz";

function setEnv(values: Record<string, string | undefined>) {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"]) {
    vi.stubEnv(name, values[name]);
  }
}

beforeEach(() => {
  vi.mocked(sweepAbandonedFixtures).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("db suite global setup", () => {
  it("runs with its database and sweep replaced (a failed mock here would make every test below unsafe)", () => {
    expect(vi.isMockFunction(serviceDb)).toBe(true);
    expect(vi.isMockFunction(sweepAbandonedFixtures)).toBe(true);
  });

  it("refuses production's API URL before sweeping (mutation: drop the guard call → FAILS)", async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.invalid`,
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_UNIT_TEST_ONLY",
    });
    await expect(setup()).rejects.toThrow(/The db suite refuses to run against production: NEXT_PUBLIC_SUPABASE_URL/);
    expect(sweepAbandonedFixtures).not.toHaveBeenCalled();
  });

  it("refuses production's DB URL even with no API credentials, because withRollback connects on it alone", async () => {
    setEnv({ SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@pooler.invalid:5432/postgres` });
    await expect(setup()).rejects.toThrow(/refuses to run against production: SUPABASE_DB_URL/);
    expect(sweepAbandonedFixtures).not.toHaveBeenCalled();
  });

  it("sweeps on the CI project", async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: `https://${CI_REF}.supabase.invalid`,
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_UNIT_TEST_ONLY",
      SUPABASE_DB_URL: `postgresql://postgres.${CI_REF}:pw@pooler.invalid:5432/postgres`,
    });
    await expect(setup()).resolves.toBeUndefined();
    expect(sweepAbandonedFixtures).toHaveBeenCalledTimes(1);
  });

  it("still skips the sweep, without refusing, when there are no credentials", async () => {
    setEnv({});
    await expect(setup()).resolves.toBeUndefined();
    expect(sweepAbandonedFixtures).not.toHaveBeenCalled();
  });
});
