import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The three places a Playwright run of playwright.config.ts can start
 * writing, each proven to refuse production by IMPORTING it with fake env —
 * the same way Playwright loads it — rather than by reading its source:
 *
 *   - playwright.config.ts: every run of this config loads it, including
 *     `--no-deps` (which skips the `setup` project) and `--project=teardown`.
 *   - auth.setup.ts: creates the client fixture and runs the fixture sweep.
 *   - sweep.setup.ts: the manual sweep (`pnpm --filter web e2e:sweep`).
 *
 * Everything those files reach is replaced below, so no path through this
 * file connects anywhere: no .env.local is read, no Clerk or Supabase client
 * exists, and the hosts are `.invalid` (RFC 6761) on top of that.
 */

const fakeFiles = vi.hoisted(() => ({ contents: {} as Record<string, string> }));
// Hoisted so a factory re-run after vi.resetModules() hands out the SAME spies.
const spies = vi.hoisted(() => ({
  test: vi.fn(), sweepStaleFixtures: vi.fn(), serviceDb: vi.fn(), clerkClient: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    existsSync: (p: string) => p in fakeFiles.contents,
    readFileSync: (p: string) => {
      if (!(p in fakeFiles.contents)) throw new Error(`test: no fake file ${p}`);
      return Buffer.from(fakeFiles.contents[p]!);
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});
vi.mock("dotenv", async (importOriginal) => {
  const real = await importOriginal<typeof import("dotenv")>();
  return { ...real, config: vi.fn() };
});
vi.mock("@playwright/test", () => ({
  test: spies.test,
  defineConfig: (c: unknown) => c,
  devices: { "Desktop Chrome": {} },
}));
vi.mock("@clerk/testing/playwright", () => ({ clerk: {}, clerkSetup: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: spies.clerkClient }));
vi.mock("@bis/db", () => ({
  serviceDb: spies.serviceDb, createAccount: vi.fn(), setClientAccess: vi.fn(), createContact: vi.fn(),
  setBranding: vi.fn(), uploadBrandLogo: vi.fn(), createForm: vi.fn(), updateForm: vi.fn(),
}));
vi.mock("./sweep", () => ({ sweepStaleFixtures: spies.sweepStaleFixtures, formatSweepReport: vi.fn() }));

import { PRODUCTION_SUPABASE_REF } from "./production-guard";

const PROD = PRODUCTION_SUPABASE_REF;
const CI_REF = "odnobiodsftffphuuosz";

/** Every REQUIRED_ENV name in playwright.config.ts, fake, plus a Supabase URL. */
function stubEnv(supabaseUrl: string) {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_UNIT_TEST_ONLY");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_UNIT_TEST_ONLY");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_UNIT_TEST_ONLY");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_UNIT_TEST_ONLY");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  vi.stubEnv("SUPABASE_DB_URL", undefined);
}

beforeEach(() => {
  vi.resetModules();
  spies.test.mockClear();
  fakeFiles.contents = {};
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("e2e entry points refuse production", () => {
  it("run with every client replaced (a failed mock here would make every test below unsafe)", async () => {
    const [pw, sweep, db, clerk] = await Promise.all([
      import("@playwright/test"), import("./sweep"), import("@bis/db"), import("@clerk/nextjs/server"),
    ]);
    expect(pw.test).toBe(spies.test);
    expect(sweep.sweepStaleFixtures).toBe(spies.sweepStaleFixtures);
    expect(db.serviceDb).toBe(spies.serviceDb);
    expect(clerk.clerkClient).toBe(spies.clerkClient);
  });

  describe("playwright.config.ts", () => {
    it("refuses production in the environment (mutation: drop the config's process.env guard → FAILS)", async () => {
      stubEnv(`https://${PROD}.supabase.invalid`);
      await expect(import("../../playwright.config")).rejects
        .toThrow(/The e2e suite refuses to run against production: NEXT_PUBLIC_SUPABASE_URL/);
    });

    it("refuses production named in apps/web/.env.local, even when the environment names the CI project (mutation: drop the file guard → FAILS)", async () => {
      stubEnv(`https://${CI_REF}.supabase.invalid`);
      fakeFiles.contents[".env.local"] = `SUPABASE_DB_URL=postgresql://postgres.${PROD}:pw@pooler.invalid:5432/postgres\n`;
      await expect(import("../../playwright.config")).rejects
        .toThrow(/The e2e suite \(apps\/web\/\.env\.local\) refuses to run against production: SUPABASE_DB_URL/);
    });

    it("loads on the CI project", async () => {
      stubEnv(`https://${CI_REF}.supabase.invalid`);
      fakeFiles.contents[".env.local"] = `SUPABASE_DB_URL=postgresql://postgres.${CI_REF}:pw@pooler.invalid:5432/postgres\n`;
      const config = (await import("../../playwright.config")).default as { projects?: { name: string }[] };
      expect(config.projects?.map((p) => p.name)).toContain("setup");
    });
  });

  describe("auth.setup.ts", () => {
    it("refuses production before a setup test is even registered (mutation: drop the guard call → FAILS)", async () => {
      stubEnv(`https://${PROD}.supabase.invalid`);
      await expect(import("../auth.setup")).rejects
        .toThrow(/The e2e setup refuses to run against production: NEXT_PUBLIC_SUPABASE_URL/);
      expect(spies.test).not.toHaveBeenCalled();
    });

    it("registers its two setup tests on the CI project", async () => {
      stubEnv(`https://${CI_REF}.supabase.invalid`);
      await import("../auth.setup");
      expect(spies.test).toHaveBeenCalledTimes(2);
    });
  });

  describe("sweep.setup.ts", () => {
    it("refuses production before the sweep test is registered (mutation: drop the guard call → FAILS)", async () => {
      stubEnv(`https://${PROD}.supabase.invalid`);
      await expect(import("../sweep.setup")).rejects
        .toThrow(/The e2e fixture sweep refuses to run against production: NEXT_PUBLIC_SUPABASE_URL/);
      expect(spies.test).not.toHaveBeenCalled();
    });

    it("registers the sweep on the CI project", async () => {
      stubEnv(`https://${CI_REF}.supabase.invalid`);
      await import("../sweep.setup");
      expect(spies.test).toHaveBeenCalledTimes(1);
    });
  });

  it("no test here ever reached the sweep", () => {
    expect(spies.sweepStaleFixtures).not.toHaveBeenCalled();
  });
});
