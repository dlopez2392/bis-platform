import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // Refuses to start when packages/db/.env names production — see
    // src/test/refuse-production.ts. The same guard the db suite's own
    // globalSetup runs before its sweep.
    globalSetup: ["src/test/refuse-production.setup.ts"],
    testTimeout: 20000,
    // Verbose so a missing-credentials skip prints its reason inline instead
    // of being silently absorbed into "N skipped" -- this suite has no
    // hermetic fallback, so a quiet skip could be mistaken for a pass.
    reporters: ["verbose"],
  },
});
