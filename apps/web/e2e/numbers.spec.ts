import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { m } from "../src/lib/messages";
import { SEEDED_ACCOUNT_NAME } from "./support";

// The agency numbers inventory (/dashboard/numbers) — the second screen in
// this app whose whole purpose is to span every account, and the one that
// puts every client's phone line on one page with a control to move it.
//
// A boundary test first, a feature test second, the same shape and for the
// same reasons as work-queue.spec.ts (whose file-level comment carries the
// full reasoning for why the assertion below is the redirect TARGET and a
// cross-tenant canary rather than "the heading is absent"). The stakes are
// higher here than on the work queue: that screen leaks other accounts'
// names, this one would leak their phone numbers and offer a control that
// takes them away.
//
// requireAgency() (src/lib/auth.ts:7-13) is the first line of the page and
// of both actions, before any read — so the cross-tenant query is never
// issued on a client's behalf at all.
//
// This spec never mutates. It navigates and asserts: every write on this
// page moves or silences a REAL phone number in the one Supabase project
// that is also production, and there is no fixture number to practise on.
// The per-run client fixture appears here only as the vehicle for a real
// client identity (auth.setup.ts creates it, auth.teardown.ts deletes it);
// none of its own rows are read or asserted on.
test.describe("a client cannot reach the agency numbers inventory", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client is redirected to their own dashboard", async ({ page }) => {
    const fixture = JSON.parse(
      readFileSync("e2e/.auth/client-fixture.json", "utf-8"),
    ) as { accountId: string };

    await page.goto("/dashboard/numbers");

    await expect(page).toHaveURL(
      new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard(?:[/?]|$)`),
    );

    // The real leak this guards, not a heading proxy: another account's name
    // reaching a client's browser. `SEEDED_ACCOUNT_NAME` ("Test Client One")
    // is a real, distinct account in this shared environment and the same
    // canary the other two client-boundary specs use — and on THIS page it is
    // also the account that actually holds a number, so its presence would
    // mean an inventory row had been rendered.
    await expect(page.getByText(SEEDED_ACCOUNT_NAME)).toHaveCount(0);
  });
});

// The positive control that makes the `toHaveCount(0)` above falsifiable:
// the same locators, on the one identity that SHOULD see this screen.
// Without it, a typo in the copy key or a route that 404s would leave the
// negative assertion green forever.
test.describe("the agency admin can reach the inventory this file guards", () => {
  test.use({ storageState: "e2e/.auth/state.json" });

  test("the agency admin sees the inventory and a number on it", async ({ page }) => {
    await page.goto("/dashboard/numbers");

    // From the message catalogue, never a hand-written literal — a literal
    // has nothing keeping it in step with the copy.
    await expect(page.getByRole("heading", { name: m["numbers.title"] })).toBeVisible();

    // The canary the client above must NOT see, asserted present here. This
    // is also what proves the page renders rows at all rather than the empty
    // state: `Test Client One` holds a number in this environment, and its
    // name appears only on that number's row.
    await expect(page.getByText(SEEDED_ACCOUNT_NAME).first()).toBeVisible();
  });
});
