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
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
