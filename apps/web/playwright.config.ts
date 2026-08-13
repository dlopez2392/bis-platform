import { defineConfig, devices } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/state.json";

// True only when the caller named the sweep project themselves, in either
// spelling the CLI accepts. See the `sweep` project below.
const SWEEP_REQUESTED = process.argv.some(
  (arg, i) => arg === "--project=sweep"
    || (arg === "--project" && process.argv[i + 1] === "sweep"),
);

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
    // Declared ONLY when explicitly asked for, because Playwright runs every
    // declared project on a bare `playwright test` — there is no "manual
    // project" — and an unconditional entry here put a second, redundant
    // sweep in every ordinary run.
    //
    // Keyed on argv rather than an env var deliberately: `E2E_SWEEP=1 cmd` is
    // not valid in PowerShell, which is the shell this project is developed
    // in, so an env-var gate would work on CI and quietly not for danlo.
    //
    // It exists so a human can see — or, with E2E_SWEEP_DELETE=1, clear — the
    // fixtures that killed runs stranded in the shared dev environment. The
    // same sweep runs automatically at the top of auth.setup.ts; this is the
    // manual door onto it, reusing the runner's TypeScript and env loading
    // rather than adding a script runner to the workspace for one file.
    ...(SWEEP_REQUESTED
      ? [{ name: "sweep", testMatch: /sweep\.setup\.ts/ }]
      : []),
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
