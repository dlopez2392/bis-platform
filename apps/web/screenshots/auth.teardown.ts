import { test as teardown } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const AGENCY_FIXTURE_FILE = "screenshots/.auth/agency-fixture.json";

// Deletes the throwaway agency user screenshots/auth.setup.ts made. A
// teardown PROJECT (playwright.screenshots.config.ts), not a `finally` in
// the capture spec, so it runs whether or not the capture passed. A user a
// killed run leaves behind is swept by the next e2e run: same Clerk instance,
// same e2e-agency-<stamp> shape (e2e/fixtures/stale.ts).
teardown("delete the capture's agency user", async () => {
  if (!existsSync(AGENCY_FIXTURE_FILE)) return;
  const { clerkUserId } = JSON.parse(readFileSync(AGENCY_FIXTURE_FILE, "utf-8")) as { clerkUserId: string };
  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUser(clerkUserId);
  } catch (e) {
    console.error(`capture teardown: failed to delete agency Clerk user ${clerkUserId}: ${String(e)}`);
  }
});
