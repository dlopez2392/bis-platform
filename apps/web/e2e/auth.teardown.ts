import { test as teardown } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb, setClientAccess } from "@bis/db";

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

  try {
    // contacts has no ON DELETE behavior on its account_id FK
    // (0003_crm_core.sql), so it must be cleared before the accounts row
    // itself, same as events.
    await db.from("contacts").delete().eq("account_id", fixture.accountId);
    await db.from("events").delete().eq("account_id", fixture.accountId);
    const { error: delErr } = await db.from("accounts").delete().eq("id", fixture.accountId);
    if (delErr) {
      console.error(`e2e teardown: account delete failed: ${delErr.message}`);
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
