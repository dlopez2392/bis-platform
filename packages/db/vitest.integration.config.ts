import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20000,
    // Verbose so a missing-credentials skip prints its reason inline instead
    // of being silently absorbed into "N skipped" -- this suite has no
    // hermetic fallback, so a quiet skip could be mistaken for a pass.
    reporters: ["verbose"],
  },
});
