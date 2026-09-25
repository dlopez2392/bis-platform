import { defineConfig, devices } from "@playwright/test";
import { parse as parseEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { refuseProduction } from "./e2e/fixtures/production-guard";

const AUTH_FILE = "e2e/.auth/state.json";

/**
 * The env vars WITHOUT WHICH THIS SUITE LIES, checked before a single test
 * runs. CI already has exactly this check (.github/workflows/ci.yml, "Check
 * that the repository secrets are configured"); a developer's terminal had
 * none, and that asymmetry cost a day.
 *
 * What it cost, on 2026-09-19: `NEXT_PUBLIC_SUPABASE_ANON_KEY` was absent
 * from apps/web/.env.local. `userDb()` throws without it, so EVERY page under
 * [accountId]/ 500'd — while /dashboard/accounts kept rendering, because it
 * is still on serviceDb(). contact-detail.spec.ts therefore failed locally on
 * a contacts table that was empty for a reason nothing on screen named, on a
 * main whose CI run for the same commit was green. The conclusion drawn was
 * "main is red and the e2e gate is untrustworthy" — the gate was fine; the
 * machine running it was not. .env.example's own comment predicted this
 * failure word for word ("easy to misread as 'the CRM is broken' rather than
 * a missing var"); a comment in a file nobody re-reads is not a guard.
 *
 * A var counts as present if it is in `process.env` (how CI supplies them) OR
 * in apps/web/.env.local (how a developer does, and the file `next build`
 * itself reads). Both spellings of that path are tried, for the reason
 * auth.setup.ts spells out at its own `loadEnv` pair: this runs with apps/web
 * as cwd under `pnpm --filter web test:e2e`, so `.env.local` is the one that
 * resolves and `apps/web/.env.local` is a defensive no-op — reversed for a
 * repo-root invocation.
 *
 * Deliberately NOT the same list as CI's. SUPABASE_DB_URL is on CI's because
 * `pnpm check` runs the packages/db suite; nothing in the Playwright run
 * touches it. Requiring it here would fail a suite that would otherwise pass
 * — the mirror-image mistake of this file's own `APP_ORIGIN` note in ci.yml.
 */
const REQUIRED_ENV = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  // The one that was missing. userDb() — every in-account page and all of the
  // in-account server actions — throws "Supabase url/anon env vars missing"
  // without it, at request time, as a 500 the browser renders as a blank
  // table rather than as an error naming a variable.
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const fileEnv: Record<string, string> = {};
for (const path of [".env.local", "apps/web/.env.local"]) {
  if (existsSync(path)) Object.assign(fileEnv, parseEnv(readFileSync(path)));
}
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name] && !fileEnv[name]);
if (missingEnv.length > 0) {
  const it = missingEnv.length === 1 ? "it" : "them";
  throw new Error(
    `e2e cannot run: missing ${missingEnv.join(", ")}.\n` +
      `Add ${it} to apps/web/.env.local — see .env.example, which documents what each ` +
      `one is for. Without ${it} the app builds and starts, signs you in, and then 500s ` +
      `every in-account page — which reads on screen as empty tables rather than as a ` +
      `configuration error, so the suite fails somewhere far from the cause.`,
  );
}

/**
 * Refuses production before the build starts or any project runs.
 *
 * CI runs this suite on its own Supabase project behind
 * .github/scripts/ci-target-guard.sh. A local run reads apps/web/.env.local,
 * and until that file is switched (docs/runbooks/ci-supabase-project.md,
 * section 9) it names production, where the setup creates accounts, Clerk
 * users and Storage objects and the specs write.
 *
 * Here, not only in auth.setup.ts, because the setup project can be skipped:
 * `--no-deps` runs the chromium specs without it, and `--project=teardown`
 * runs the teardown alone. Every run of this config loads this file. Both
 * sources are checked, the environment and the file, because either can be
 * the one a runner process ends up reading (`dotenv` fills only what the
 * environment leaves unset). playwright.screenshots.config.ts is a separate
 * config and deliberately does not import this one.
 */
refuseProduction(process.env, "The e2e suite");
refuseProduction(fileEnv, "The e2e suite (apps/web/.env.local)");

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
