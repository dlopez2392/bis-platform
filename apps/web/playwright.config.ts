import { defineConfig, devices } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/state.json";

// True only when the caller named the sweep project themselves, in either
// spelling the CLI accepts. See the `sweep` project below.
const SWEEP_REQUESTED = process.argv.some(
  (arg, i) => arg === "--project=sweep"
    || (arg === "--project" && process.argv[i + 1] === "sweep"),
);

/**
 * Run against a PRODUCTION BUILD, not `next dev`. Set E2E_DEV=1 for the old
 * behaviour when you are iterating on a spec and want hot reload.
 *
 * This is the fix for what this project spent weeks calling "four
 * intermittent specs that fail with a different set each run". They were
 * never a product bug. `next dev` compiles each route on its FIRST visit, and
 * that compile regularly took longer than the assertion waiting on the
 * navigation it triggered — so whichever specs happened to touch a cold route
 * first were the ones that failed, which is exactly why the set moved around
 * and why every one of them passed when re-run alone.
 *
 * Measured on one machine, same commit, same specs:
 *
 *   next dev     3 failed / 7.9 min · 2 failed / 6.4 min · 4 failed / 7.7 min
 *   next start   25 passed / 2.4 min
 *
 * The build costs ~20s and buys back four minutes and the flakiness. It also
 * makes the suite test what actually ships: `next dev` and `next build` differ
 * in more than speed (dev-only warnings, no minification, different chunking).
 */
const USE_DEV_SERVER = process.env.E2E_DEV === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Serial: these specs share one server and one shared dev database, and
  // several assert against rows they create. (The original reason was
  // compile contention between workers under `next dev`; the build path
  // above removes that, but the shared-database reason stands on its own.)
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
    command: USE_DEV_SERVER ? "pnpm dev" : "pnpm build && pnpm start",
    url: "http://localhost:3000",
    // On the build path this is FALSE on purpose. `reuseExistingServer` will
    // happily adopt whatever is already listening on 3000 — including a dev
    // server someone left running — which would silently put the flakiness
    // back AND test different code than the build just produced. This project
    // has already lost a run to a stray server being adopted. Failing with
    // "port in use" is the better outcome; the dev path keeps reuse because
    // that is the whole point of iterating against it.
    reuseExistingServer: USE_DEV_SERVER,
    // Room for the build itself, which the command now includes.
    timeout: USE_DEV_SERVER ? 120_000 : 300_000,
  },
});
