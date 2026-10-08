import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planCiSeed, ciSeedMode, CI_BASELINE, CI_SEED_CONTACT } from "./config";
import { PRODUCTION_SUPABASE_REF } from "../ci/target";
import { isTestOrgId } from "../org-id";
import { DEMO_PHONE_RE } from "../demo/fiction";

/**
 * `ci:seed` writes the seeded account every e2e run reads. Its runner is the
 * second CI-only writer, so it is refused production by the same guard as
 * `db:push:ci` — proven here, before it can connect — and its constants are
 * pinned against the things that depend on them.
 */
const CI_REF = "cicicicicicicicicici";
const PROD = PRODUCTION_SUPABASE_REF;
const ciEnv = {
  BIS_CI_SUPABASE_REF: CI_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${CI_REF}.supabase.co`,
  SUPABASE_DB_URL: `postgresql://postgres.${CI_REF}:Secretpass123@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
};

describe("planCiSeed refuses production", () => {
  it("refuses the production ref", () => {
    expect(() => planCiSeed({
      BIS_CI_SUPABASE_REF: PROD,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
      SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    })).toThrow(/BIS_CI_SUPABASE_REF is production's ref/);
  });

  it("refuses production's API URL (the one the service client writes through)", () => {
    expect(() => planCiSeed({ ...ciEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }))
      .toThrow(/NEXT_PUBLIC_SUPABASE_URL points at production/);
  });

  it("refuses production's DB URL (a half-switched env file)", () => {
    expect(() => planCiSeed({
      ...ciEnv,
      SUPABASE_DB_URL: `postgresql://postgres.${PROD}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    })).toThrow(/SUPABASE_DB_URL points at production/);
  });

  it("refuses an unset CI ref", () => {
    expect(() => planCiSeed({ ...ciEnv, BIS_CI_SUPABASE_REF: undefined })).toThrow(/BIS_CI_SUPABASE_REF is not set/);
  });

  it("names the CI project and what it will seed, without the password", () => {
    const plan = planCiSeed(ciEnv);
    expect(plan.spec).toEqual(CI_BASELINE);
    expect(plan.summary).toContain(CI_REF);
    expect(plan.summary).toContain("Test Client One");
    expect(plan.summary).not.toContain("Secretpass123");
  });
});

describe("the baseline's constants", () => {
  const support = readFileSync(fileURLToPath(new URL("../../../../apps/web/e2e/support.ts", import.meta.url)), "utf8");
  const constant = (name: string) => {
    const m = new RegExp(`export const ${name} = "([^"]+)"`).exec(support);
    expect(m, `${name} in apps/web/e2e/support.ts`).not.toBeNull();
    return m![1];
  };

  it("seeds the account the e2e suite opens by name", () => {
    expect(CI_BASELINE.name).toBe(constant("SEEDED_ACCOUNT_NAME"));
  });

  it("seeds the contact the e2e suite looks for by name", () => {
    expect(`${CI_SEED_CONTACT.firstName} ${CI_SEED_CONTACT.lastName}`).toBe(constant("SEEDED_CONTACT_NAME"));
  });

  it("gives the contact an address at a reserved domain (the composer's email mode needs one)", () => {
    expect(CI_SEED_CONTACT.email).toMatch(/^[a-z]+@example\.com$/);
  });

  it("uses an org id the fixture sweep can never delete", () => {
    expect(isTestOrgId(CI_BASELINE.clerkOrgId)).toBe(false);
    expect(CI_BASELINE.clerkOrgId).toMatch(/^org_[A-Za-z0-9]+$/);
  });

  it("uses a number phone_numbers accepts (0019_voice_core.sql's check)", () => {
    expect(CI_BASELINE.phoneE164).toMatch(/^\+[0-9]{8,15}$/);
  });

  it("uses a number from the NANP fiction block, 555-01xx, that nobody can dial", () => {
    expect(CI_BASELINE.phoneE164).toMatch(/^\+1[2-9][0-9]{2}55501[0-9]{2}$/);
  });

  it("stays out of the demo tenant's +1 956 555 01xx partition", () => {
    expect(DEMO_PHONE_RE.test(CI_BASELINE.phoneE164)).toBe(false);
  });
});

/**
 * Since 2026-10-08 the e2e job seeds a throwaway stack inside its own runner
 * (`ci:seed --local-stack`), not the shared CI project. The flag is the ONLY
 * way into that mode, and the mode accepts only the runner's loopback
 * (../ci/target.ts assertLocalStackTarget): a CI-project env handed to it is
 * refused rather than seeded, and so is anything else on the command line.
 */
describe("ci:seed's mode, chosen by its one optional flag", () => {
  it("is the CI project with no argument, as ci-project-setup.yml's seed step runs it", () => {
    expect(ciSeedMode([])).toBe("ci-project");
  });

  it("is the local stack with --local-stack, as ci.yml's e2e job runs it", () => {
    expect(ciSeedMode(["--local-stack"])).toBe("local-stack");
  });

  it.each([["--local"], ["--local-stack", "--local-stack"], ["--ci-project"]])(
    "refuses anything else, naming a plain flag (mutation: ignore unknown arguments → FAILS): %s",
    (...argv) => {
      expect(() => ciSeedMode(argv)).toThrow(/ci:seed takes no argument or --local-stack/);
    },
  );

  it("never repeats an argument that is not a plain flag (it may be a DB URL, password included)", () => {
    let message = "";
    try { ciSeedMode(["postgresql://postgres:Secretpass123@127.0.0.1:54322/postgres"]); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/ci:seed takes no argument or --local-stack/);
    expect(message).not.toContain("Secretpass123");
  });
});

describe("planCiSeed on the local stack", () => {
  const localEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_DB_URL: "postgresql://postgres:Localpass456@127.0.0.1:54322/postgres",
  };

  it("seeds the same baseline on the runner's loopback, and says so without the password", () => {
    const plan = planCiSeed(localEnv, "local-stack");
    expect(plan.spec).toEqual(CI_BASELINE);
    expect(plan.summary).toContain("local Supabase stack");
    expect(plan.summary).toContain("Test Client One");
    expect(plan.summary).not.toContain("Localpass456");
  });

  it("refuses the CI project's values: the local-stack seed never writes a shared project (mutation: plan local-stack with assertCiTarget → FAILS)", () => {
    expect(() => planCiSeed(ciEnv, "local-stack")).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not a local Supabase stack's API/);
  });

  it("refuses production, by production's own message", () => {
    expect(() => planCiSeed({ ...localEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }, "local-stack"))
      .toThrow(/NEXT_PUBLIC_SUPABASE_URL points at production/);
  });

  it("and the CI-project mode still refuses the local stack, so neither mode can stand in for the other", () => {
    expect(() => planCiSeed({ ...localEnv, BIS_CI_SUPABASE_REF: CI_REF })).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not the CI project's API URL/);
  });
});
