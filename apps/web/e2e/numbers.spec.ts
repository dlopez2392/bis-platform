import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { listAllPhoneNumbers, serviceDb } from "@bis/db";
import { m } from "../src/lib/messages";

// This file reads `phone_numbers` directly from the Playwright runner
// process (never through a Next.js request) to learn what the inventory
// should contain — the same path, and the same two dotenv lines,
// work-queue.spec.ts and automations.spec.ts use.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// The agency numbers inventory (/dashboard/numbers) — the second screen in
// this app whose whole purpose is to span every account, and the one that
// puts every client's phone line on one page with a control to move it.
//
// A boundary test first, a feature test second, the same shape and for the
// same reasons as work-queue.spec.ts (whose file-level comment carries the
// full reasoning for why the assertion below is the redirect TARGET plus a
// cross-tenant canary rather than "the heading is absent"). The stakes are
// higher here than on the work queue: that screen would leak other accounts'
// names, this one would leak their phone numbers.
//
// requireAgency() (src/lib/auth.ts:7-13) is the first line of the page and
// of both actions, before any read — so the cross-tenant query is never
// issued on a client's behalf at all.
//
// THE CANARY IS A PHONE NUMBER READ FROM THE DATABASE AT RUN TIME, never a
// hard-coded account name. The first draft of this file asserted that
// "Test Client One" appeared on the agency's inventory, because that account
// held a number on the day it was written. It stopped holding one hours
// later, when that number was moved to another company — through the very
// workflow this screen exists to serve. An assertion about WHICH company
// holds a number is an assertion this product is designed to invalidate;
// "some number that is not this client's must not reach this client's
// browser" is the property that actually has to hold forever.
//
// This spec never mutates. It navigates, reads and asserts: every write on
// this page moves or silences a real phone number in the one Supabase
// project that is also production, and there is no fixture number to
// practise on. The per-run client fixture appears here only as the vehicle
// for a real client identity (auth.setup.ts creates it, auth.teardown.ts
// deletes it); it owns no phone number, which is what makes every row in the
// table a foreign one from its point of view.
test.describe("a client cannot reach the agency numbers inventory", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client is redirected out, and no other tenant's number reaches them", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };

    const foreign = (await listAllPhoneNumbers(serviceDb()))
      .filter((n) => n.account_id !== fixture.accountId)
      .map((n) => n.e164);
    // Without this the loop below passes by having nothing to check — the
    // exact way a cross-tenant assertion rots into a no-op.
    expect(foreign.length).toBeGreaterThan(0);

    await page.goto("/dashboard/numbers");

    // The client lands on their OWN account dashboard, not merely "somewhere
    // that isn't /dashboard/numbers" — see work-queue.spec.ts for why the
    // positive form is the one that exercises the guard.
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard(?:[/?]|$)`),
    );

    // The real leak, not a heading proxy. Every one of these belongs to some
    // other company; not one of them has any business being in this
    // browser's DOM, whatever the URL bar says.
    for (const e164 of foreign) {
      await expect(page.getByText(e164)).toHaveCount(0);
    }
  });
});

// The positive control that makes the `toHaveCount(0)` above falsifiable:
// the same locator family, on the one identity that SHOULD see this screen.
// Without it, a route that 404'd or a number format the locator never
// matches would leave the negative assertion green forever.
test.describe("the agency admin can reach the inventory this file guards", () => {
  test.use({ storageState: "e2e/.auth/state.json" });

  test("the agency admin sees the inventory, with real numbers on it", async ({ page }) => {
    // READ, RENDER, READ. The first draft read the table once and required
    // every row it returned to be on the page. That raced the rest of the
    // suite: `calls.spec.ts` and `contacts-drawer.spec.ts` each assign a
    // timestamp-unique fixture number and delete it in their own teardown,
    // so a row can exist when this reads and be gone by the time the page
    // renders. CI caught it on `+999613461693567`, a fixture number that no
    // longer existed by the time the failure was investigated.
    //
    // Bracketing the render closes that properly rather than weakening the
    // assertion to "at least one row appeared". A number present in BOTH
    // reads was present for the whole window, so it MUST have been on the
    // page; anything created or destroyed mid-test simply drops out of the
    // intersection. (The one theoretical escape — deleted and re-created
    // under the same e164 inside this window — cannot happen: `e164` is
    // globally unique and every fixture derives it from a timestamp.)
    const before = await listAllPhoneNumbers(serviceDb());

    await page.goto("/dashboard/numbers");

    // From the message catalogue, never a hand-written literal — a literal
    // has nothing keeping it in step with the copy.
    await expect(page.getByRole("heading", { name: m["numbers.title"] })).toBeVisible();

    const after = new Set((await listAllPhoneNumbers(serviceDb())).map((n) => n.e164));
    const stable = before.map((n) => n.e164).filter((e164) => after.has(e164));
    // Without this the loop below could pass by having nothing to check.
    expect(stable.length).toBeGreaterThan(0);

    // Every stable number is on the page — still a completeness assertion,
    // not merely "a row rendered". The inventory's one promise is that it is
    // the WHOLE inventory, and a filter that quietly dropped a row (an inner
    // join losing a number whose account row was gone, say) is precisely the
    // bug that would hide a reclaimable line from the agency.
    for (const e164 of stable) {
      await expect(page.getByText(e164).first()).toBeVisible();
    }
  });
});
