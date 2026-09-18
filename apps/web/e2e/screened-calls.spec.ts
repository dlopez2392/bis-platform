import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { m } from "../src/lib/messages";
import { SEEDED_ACCOUNT_NAME } from "./support";

// The screened-calls log (/dashboard/screened) — agency-only, and the third
// screen in this app whose whole purpose is to span every account (after
// the work queue and the numbers inventory). A boundary test first, a
// feature test second, the same shape and for the same reasons as
// work-queue.spec.ts's own file-level comment: the assertion below is the
// redirect TARGET plus a cross-tenant canary, not merely "the heading is
// absent" — that heading check is trivially true of nearly any page the
// client could land on and proves nothing about the guard actually firing.
//
// `requireAgency()` (src/lib/auth.ts:7-13) is the literal first line of the
// page, before any read — so the cross-tenant query is never issued on a
// client's behalf at all, and this table is unreadable by `authenticated`
// at the grant level besides.
//
// Signed in as the client fixture auth.setup.ts creates ("authenticate as
// client user (no app_role)") — the same identity, and the same storageState
// file, work-queue.spec.ts and client-access.spec.ts drive. Fixture creation
// AND cleanup live outside this file: auth.setup.ts creates the Clerk
// user/org and the accounts row; auth.teardown.ts deletes all of it
// afterward, unconditionally.
//
// This spec never mutates: it navigates and asserts. The per-run fixture
// account exists here only as the vehicle for a real client identity —
// nothing about screened_calls is read or written here, and nothing here
// touches `Test Client One` or any live account.
test.describe("a client cannot reach the agency screened-calls log", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client cannot reach the agency screened-calls log", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };

    await page.goto("/dashboard/screened");

    // The client lands on their OWN account dashboard, not merely
    // "somewhere that isn't /dashboard/screened" — see work-queue.spec.ts's
    // file-level comment for why the stronger, positive assertion is the
    // one that actually exercises the guard. `(?:[/?]|$)` so a trailing
    // slash or a query string on the same, correctly-guarded destination
    // still matches.
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard(?:[/?]|$)`),
    );

    // The heading is only a proxy for the real leak: another account's name
    // reaching a client's browser. `SEEDED_ACCOUNT_NAME` ("Test Client One",
    // support.ts) is a real, distinct account in this shared environment —
    // not this run's own fixture. This page is the client's OWN dashboard;
    // that account's name has no legitimate reason to ever appear on it.
    await expect(page.getByText(SEEDED_ACCOUNT_NAME)).toHaveCount(0);
  });
});

// The positive control the negative assertion above needs to be falsifiable
// at all: `getByText(SEEDED_ACCOUNT_NAME).toHaveCount(0)` is a locator that
// has never been proven to match anything in this file — a typo in the
// string, a route that 404'd, or a copy edit all leave a bare
// `toHaveCount(0)` green forever. Signed in as the one identity that SHOULD
// see this screen (the project's default chromium storageState,
// e2e/.auth/state.json — the agency admin auth.setup.ts signs in as).
test.describe("the agency admin can reach the log this file guards", () => {
  test.use({ storageState: "e2e/.auth/state.json" });

  test("the agency admin sees the screened-calls page's own heading", async ({ page }) => {
    await page.goto("/dashboard/screened");

    // From the message catalogue, never a hand-written literal — a literal
    // here has nothing keeping it in step with the copy.
    await expect(
      page.getByRole("heading", { name: m["screened.title"] }),
    ).toBeVisible();
  });
});
