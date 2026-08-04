import { defineConfig, devices } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/state.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Serial: these specs share one Next.js dev server. Running them
  // concurrently means the first-ever hit to /contacts or /pipeline in a
  // given run pays Turbopack's cold-compile cost while other workers are
  // also hammering the same server, which made navigation assertions flake
  // under their default timeout. One worker removes that contention.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, teardown: "teardown" },
    // Runs after every "chromium" test finishes, regardless of which spec
    // files were selected — a plain finally in a spec only fires when that
    // spec is part of the run. See auth.teardown.ts for why that matters:
    // "setup" has no test filter of its own, so it creates the client-access
    // fixture (a real Clerk user + org + Postgres rows) on every invocation,
    // even one that never runs client-access.spec.ts.
    { name: "teardown", testMatch: /auth\.teardown\.ts/ },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
