import { test as teardown } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb, setClientAccess, removeBrandLogo } from "@bis/db";
import { deleteAccountCascade, emptySweepReport } from "./fixtures/sweep";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const CLIENT_FIXTURE_FILE = "e2e/.auth/client-fixture.json";

type ClientFixture = {
  accountId: string;
  clerkOrgId: string;
  clerkUserId: string;
  email: string;
  companyName: string;
  contactName: string;
  brandName?: string;
  brandLogoPath?: string;
  brandColor?: string;
  formPublicId?: string;
};

// The `teardown` project attached to "setup" (see playwright.config.ts).
// Playwright runs this once after every dependent ("chromium") test has
// finished, regardless of which spec files were selected — unlike a spec's
// own `finally`, which only fires when that spec is actually part of the
// run. auth.setup.ts's "authenticate as client user" test has no filter of
// its own, so it creates this fixture on every invocation of `pnpm
// --filter web test:e2e`, even `... blueprints.spec.ts` or any --grep that
// never touches client-access.spec.ts. Cleanup has to be equally
// unconditional or exactly that class of invocation leaks a real Clerk
// user, a real Clerk org, and real Postgres rows into the shared dev
// environment every time — this project has a documented history of that
// exact failure mode.
teardown("delete the client-access e2e fixture", async () => {
  if (!existsSync(CLIENT_FIXTURE_FILE)) return;
  const fixture = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf-8")) as ClientFixture;
  const db = serviceDb();

  // Every step below is independently wrapped so one failure (a rate limit,
  // a row already gone, a credentials hiccup) can't skip the rest — same
  // reasoning the spec's own former `finally` used.

  // Restore the flag before deleting anything, in case a later delete fails
  // and the row survives — the same "restore what you toggle" reasoning as
  // before, just relocated.
  try {
    await setClientAccess(db, fixture.accountId, true, fixture.clerkUserId);
  } catch (e) {
    console.error(`e2e teardown: restore client_access_enabled failed: ${String(e)}`);
  }

  // The uploaded logo lives in Storage, not Postgres, so deleting the accounts
  // row leaves it behind. Nothing else references it once the row is gone, so
  // a miss here is an object that no path can ever reach again.
  if (fixture.brandLogoPath) {
    try {
      await removeBrandLogo(db, fixture.brandLogoPath);
    } catch (e) {
      console.error(`e2e teardown: failed to delete brand logo ${fixture.brandLogoPath}: ${String(e)}`);
    }
  }

  try {
    // The sweep's cascade, not a local table list: the booking and
    // calendar-settings journeys now run ON this fixture account
    // (2026-08-30), leaving calendars, bookings, conversations and messages
    // behind — all `on delete restrict` upstream of the accounts row. This
    // file used to carry its own shorter list, which is exactly the drift
    // that would have made the accounts delete start failing SILENTLY the
    // day those specs moved; one exported list, two callers.
    const report = emptySweepReport();
    await deleteAccountCascade(db, fixture.accountId, report);
    for (const err of report.errors) {
      console.error(`e2e teardown: ${err}`);
    }
  } catch (e) {
    console.error(`e2e teardown: postgres delete failed: ${String(e)}`);
  }

  const clerk = await clerkClient();
  try {
    await clerk.organizations.deleteOrganization(fixture.clerkOrgId);
  } catch (e) {
    console.error(`e2e teardown: failed to delete Clerk org ${fixture.clerkOrgId}: ${String(e)}`);
  }
  try {
    await clerk.users.deleteUser(fixture.clerkUserId);
  } catch (e) {
    console.error(`e2e teardown: failed to delete Clerk user ${fixture.clerkUserId}: ${String(e)}`);
  }
});
