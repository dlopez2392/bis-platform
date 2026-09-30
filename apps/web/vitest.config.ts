import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
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
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts", "ci/**/*.test.ts"],
    // Runtime-only configuration is pinned OFF for the unit suite, whatever
    // the ambient environment holds. `originFrom` checks APP_ORIGIN ahead of
    // the Host header by design, so eleven tests that assert host-derived
    // behaviour (origin.test.ts, and the booking/form action suites that
    // build links) silently invert when it is set — which is exactly what
    // happened the first time CI ran with the deployment's env vars in
    // scope. Blank reads as unset (`configuredOrigin` trims, then nulls an
    // empty string), so this pins the default rather than inventing one, and
    // the tests that DO exercise APP_ORIGIN set it themselves through
    // `vi.stubEnv` or a literal env object.
    env: { APP_ORIGIN: "" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
