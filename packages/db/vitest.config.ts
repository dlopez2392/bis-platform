import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Refuses to start when the env names production (src/test/refuse-production.ts),
    // then clears fixture accounts a killed run left behind in the project the
    // run points at, before anything else touches it — see src/test/sweep-fixtures.ts.
    globalSetup: ["src/test/global-setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "src/**/*.integration.test.ts",
    ],
    // These are live-network integration tests against one shared Supabase
    // project, not unit tests — `pnpm check` runs this suite in parallel
    // with the web suite, and the heaviest tests here measure ~9-10s ALONE,
    // uncontended. 20s left no headroom under that contention, so the gate
    // was failing on wall clock (`Test timed out in 20000ms`) rather than on
    // behaviour — and which file lost the race moved between runs. The
    // trade: a genuinely hung test now takes 60s to report instead of 20s.
    testTimeout: 60000,
  },
});
