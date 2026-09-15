import { defineConfig, devices } from "@playwright/test";

const AUTH_FILE = "screenshots/.auth/state.json";

/**
 * A separate config from `playwright.config.ts`, not another project inside
 * it. Playwright runs every declared project on a bare `playwright test`, so a
 * capture project living in the main config would run on every CI push — six
 * screenshots nobody asked for, against the shared database, on the gate's
 * clock. Same reasoning the `sweep` project is argv-gated over there; a second
 * config is the cleaner version of it.
 *
 * Production build, for the reason the e2e config documents at length: `next
 * dev` compiles each route on first visit, and a capture of a route mid-compile
 * is a screenshot of a loading state.
 */
export default defineConfig({
  testDir: "./screenshots",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  // Generous: these navigate a production app and wait for real data.
  expect: { timeout: 20_000 },
  timeout: 120_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "capture",
      testMatch: /capture\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
    },
  ],
  webServer: {
    command: process.env.E2E_DEV === "1" ? "pnpm dev" : "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: process.env.E2E_DEV === "1",
    timeout: process.env.E2E_DEV === "1" ? 120_000 : 300_000,
  },
});
