import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// `e2e/**` is included for `.test.ts` only, never `.spec.ts`: Playwright
// owns the specs and they would fail instantly under vitest. What lives
// here is the pure decision module behind the fixture sweep — which
// decides what gets DELETED from the shared dev database — and a decision
// that dangerous belongs in a unit test rather than only in the e2e run
// that acts on it.
//
// `ci/**` holds the tests for the CI preflight scripts under
// .github/scripts/. Those scripts belong to no workspace package, and a
// test that `pnpm check` does not collect proves nothing, so they are
// tested from here.
const SUITE = ["src/**/*.test.ts", "e2e/**/*.test.ts", "ci/**/*.test.ts"];

// The web tests that need a real Supabase database: each loads .env.local
// and creates and deletes real rows through serviceDb(). CI's verify-db job
// runs them on its own stack (`--project live`); verify-app runs every other
// file with NO Supabase value in scope (`--project unit`), so the two jobs
// run in parallel (2026-11-12; ci-workflow.test.ts pins that together they
// are exactly `pnpm check`). Name a new one `*.live.test.ts`. One that is
// missed here fails red in verify-app, "SUPABASE_SERVICE_ROLE_KEY missing",
// never silently. Every pattern sits inside SUITE, so the projects partition
// it: `vitest run` with no `--project` (what `pnpm check` runs) runs both.
// ci/*.live.test.ts (2026-11-13): the migration runner's tests against a real
// Postgres, which they find through the same SUPABASE_DB_URL (verify-db's
// stack) and refuse unless it is loopback.
const NEEDS_DATABASE = ["src/**/*.live.test.ts", "src/**/actions.returning-lead.test.ts", "ci/**/*.live.test.ts"];

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: SUITE, exclude: [...configDefaults.exclude, ...NEEDS_DATABASE] } },
      { extends: true, test: { name: "live", include: NEEDS_DATABASE } },
    ],
    // Runtime-only configuration is pinned OFF for the unit suite, whatever
    // the ambient environment holds. `originFrom` checks APP_ORIGIN ahead of
    // the Host header by design, so eleven tests that assert host-derived
    // behaviour (origin.test.ts, and the booking/form action suites that
    // build links) silently invert when it is set — which is exactly what
    // happened the first time CI ran with the deployment's env vars in
    // scope. Blank reads as unset (`configuredOrigin` trims, then nulls an
    // empty string), so this pins the default rather than inventing one, and
    // the tests that DO exercise APP_ORIGIN set it themselves through
    // `vi.stubEnv` or a literal env object. SCANNER_URL/SCANNER_SECRET
    // likewise (S-07 2a): a developer's shell holding the real worker's
    // values would otherwise turn the cron route's and the sentinel's
    // not-configured counters into a live scan; `scannerConfig` trims and
    // nulls a blank. AI_PROVIDER / AI_GATEWAY_OFF: a developer's shell or
    // .env.local must not switch every caller test to the fake or to off
    // (item 8a-1). BILLING_ENFORCE (M7a PR-4): a shell holding Production's
    // "1" would pause-gate every suite (route.reads.test.ts's read fence goes
    // red); the tests that exercise the switch set it with `vi.stubEnv`.
    // CRON_FANOUT (F-196): a developer's ambient CRON_FANOUT=1 must not flip
    // route.test.ts onto the fan-out path; that test sets it with
    // `vi.stubEnv` itself.
    env: { APP_ORIGIN: "", SCANNER_URL: "", SCANNER_SECRET: "", AI_PROVIDER: "", AI_GATEWAY_OFF: "", BILLING_ENFORCE: "", CRON_FANOUT: "" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
