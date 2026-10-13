import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, createContact } from "@bis/db";
import { m } from "../src/lib/messages";
import { mintClientToken } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase and
// Clerk from the Playwright runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * WHY THIS FILE EXISTS.
 *
 * F-085 part 1 (spec §9) adds a third role, Technician, who sees only the
 * customers assigned to them. Task 7 built the UI (the "Assigned to" field,
 * the All/Mine/Unassigned filter, the Technician's own five-item nav); 0068
 * built the database's own refusal. Neither is provable without a real
 * browser and a real Clerk session: a unit test can mock the RLS boundary
 * away and never notice it is gone.
 *
 * Everything here runs on the per-run CLIENT FIXTURE account (auth.setup.ts
 * creates it, auth.teardown.ts deletes it unconditionally) — never on
 * `Test Client One` (CLAUDE.md's hard rule). The two contacts this file seeds
 * (`Assign Mine <stamp>`, `Assign Other <stamp>`) are deleted in `afterAll`,
 * with the delete's own error checked rather than assumed.
 *
 * The four blocks below run in order ON PURPOSE (`describe.serial`): #2's
 * Technician session only sees what #1's Owner session assigned, and #4's
 * refused PATCH only proves anything while the row is still assigned to the
 * Technician — a block out of order would either find nothing to assert
 * against or assert the wrong thing silently.
 */
test.describe.configure({ timeout: 60_000 });

type ClientFixture = {
  accountId: string;
  clerkUserId: string;
  technicianUserId?: string;
  technicianClerkUserId?: string;
};
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Read at RUN TIME, never at module scope — Playwright collects every spec
 * file during COLLECTION, before the "setup" project has written this file
 * (staff-roles.spec.ts's own doc comment explains the collection-time trap).
 */
function fixture(): ClientFixture & { technicianUserId: string; technicianClerkUserId: string } {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(
      `client fixture missing at ${FIXTURE_FILE} — the "setup" project did not run ` +
      `(a filtered invocation, or a bare "playwright test <file>", skips its dependency). ` +
      `Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  const parsed = JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
  if (!parsed.technicianUserId || !parsed.technicianClerkUserId) {
    throw new Error(
      `${FIXTURE_FILE} has no technicianUserId/technicianClerkUserId — "authenticate as ` +
      `technician user" (auth.setup.ts) did not run. Run the full suite: pnpm --filter web test:e2e.`,
    );
  }
  return parsed as ClientFixture & { technicianUserId: string; technicianClerkUserId: string };
}

const stamp = Date.now();
const MINE_NAME = `Assign Mine ${stamp}`;
const OTHER_NAME = `Assign Other ${stamp}`;
const TECHNICIAN_LABEL = "E2E Technician";
const ACTOR = "e2e-assign";

let accountId = "";
let technicianUserId = "";
let technicianClerkUserId = "";
let mineId = "";
let otherId = "";

test.beforeAll(async () => {
  const f = fixture();
  accountId = f.accountId;
  technicianUserId = f.technicianUserId;
  technicianClerkUserId = f.technicianClerkUserId;

  const db = serviceDb();
  // Self-heal, same reasoning as staff-roles.spec.ts's own beforeAll: this
  // file does not control run order against client-access.spec.ts (which
  // turns client_access_enabled OFF and relies on auth.teardown.ts to
  // restore it only at the very end of the whole run).
  await setClientAccess(db, accountId, true, f.clerkUserId);

  mineId = (await createContact(db, accountId, { firstName: "Assign", lastName: `Mine ${stamp}` }, ACTOR)).id;
  otherId = (await createContact(db, accountId, { firstName: "Assign", lastName: `Other ${stamp}` }, ACTOR)).id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  for (const id of [mineId, otherId]) {
    if (!id) continue;
    const { error } = await db.from("contacts").delete().eq("id", id);
    expect(error, `deleting the probe contact ${id}`).toBeNull();
  }
});

test.describe.serial("F-085 part 1: an Owner assigns a customer; the Technician sees only it and is refused the totals", () => {
  test.describe("1. the Owner assigns", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("assigns Assign Mine to E2E Technician with Undo, then assigns it again for real", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts?who=unassigned`);
      // POSITIVE CONTROL first (server-only-writes.spec.ts's own convention):
      // both rows must be on screen before either absence check below means
      // anything.
      await expect(page.getByRole("row").filter({ hasText: MINE_NAME })).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: OTHER_NAME })).toBeVisible();

      await page.getByRole("row").filter({ hasText: MINE_NAME }).first().click();
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      // The Assigned to field sits in the drawer's who section (S-03 part 3), rendered only after
      // the route's `who` part has loaded — wait for that rather than relying on the combobox
      // locator's own auto-wait outlasting the drawer's other in-flight reads (texts/email rows)
      // that share this same section's re-renders via retryNonce.
      await expect(drawer.locator('[data-drawer-section="who"][data-state="ready"]')).toBeVisible();

      const combobox = drawer.getByRole("combobox", { name: m["assign.field.label"] });
      await combobox.click();
      await page.getByRole("option", { name: TECHNICIAN_LABEL, exact: true }).click();

      const toastText = `Assigned to ${TECHNICIAN_LABEL}.`;
      await expect(page.getByText(toastText)).toBeVisible();
      await page.getByRole("button", { name: m["assign.undo"] }).click();

      // The UI reflects the undo (a fresh read of the summary, not merely a
      // client-side revert)...
      await expect(combobox).toContainText(m["assign.unassigned"]);
      // ...and so does the database — the assertion the brief actually asks
      // for.
      const db = serviceDb();
      const afterUndo = await db.from("contacts").select("assigned_to").eq("id", mineId).single();
      expect(afterUndo.error, afterUndo.error?.message).toBeNull();
      expect(afterUndo.data?.assigned_to).toBeNull();

      // Assign again — no Undo this time. This is the state #2-#4 below
      // depend on.
      await combobox.click();
      await page.getByRole("option", { name: TECHNICIAN_LABEL, exact: true }).click();
      await expect(page.getByText(toastText)).toBeVisible();

      const afterReassign = await db.from("contacts").select("assigned_to").eq("id", mineId).single();
      expect(afterReassign.error, afterReassign.error?.message).toBeNull();
      expect(afterReassign.data?.assigned_to).toBe(technicianUserId);
    });
  });

  test.describe("2. the Technician sees exactly that customer", () => {
    test.use({ storageState: "e2e/.auth/technician-state.json" });

    test("lands on To do, with exactly the five-item sidebar", async ({ page }) => {
      await page.goto("/");
      // Two-hop landing: "/" resolves this org's account and redirects to
      // its /dashboard, which itself redirects a Technician on again
      // (requireNotTechnician) — the same accountHome destination
      // auth.setup.ts's own "authenticate as technician user" test waits on.
      await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/tasks$`));

      // Scoped to the sidebar's own <nav> (shell.spec.ts's `aside nav`
      // idiom): the page itself may hold other links, and WhoFilter (absent
      // for a Technician anyway, see the next test) is also a <nav>.
      const navLinks = page.locator("aside nav").getByRole("link");
      await expect(navLinks).toHaveCount(5);
      for (const label of ["To do", "Contacts", "Conversations", "Calls", "Calendar"]) {
        await expect(page.locator("aside nav").getByRole("link", { name: label })).toHaveCount(1);
      }
    });

    test("Contacts lists Assign Mine, never Assign Other, with no filter row", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts`);
      await expect(page.getByRole("row").filter({ hasText: MINE_NAME })).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: OTHER_NAME })).toHaveCount(0);
      // The All/Mine/Unassigned filter (WhoFilter, aria-label "Show") never
      // renders for a Technician — RLS already makes their list theirs
      // (lib/assign/view.ts's loadAssignView: canAssign false -> no filters
      // prop at all).
      await expect(page.getByRole("navigation", { name: m["assign.filter.label"] })).toHaveCount(0);
    });

    test("⌘K search for \"Assign\" offers only Assign Mine", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/tasks`);
      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.getByRole("dialog");
      await expect(palette).toBeVisible();
      await palette.getByRole("combobox").fill("Assign");

      const options = palette.getByRole("option");
      // WAIT FOR THE LIVE ANSWER before counting (palette.spec.ts's own
      // guard): the static registry settles first, the RLS-scoped search
      // a round trip later.
      await expect(options.filter({ hasText: MINE_NAME })).toBeVisible({ timeout: 15_000 });
      await expect(options).toHaveCount(1);
      await expect(options.filter({ hasText: OTHER_NAME })).toHaveCount(0);
    });
  });

  test.describe("3. the Technician is refused the totals", () => {
    test.use({ storageState: "e2e/.auth/technician-state.json" });

    test("dashboard, pipeline, website, forms and branding all land on To do", async ({ page }) => {
      const home = new RegExp(`/dashboard/accounts/${accountId}/tasks$`);
      for (const path of ["dashboard", "pipeline", "website", "forms", "branding"]) {
        await page.goto(`/dashboard/accounts/${accountId}/${path}`);
        await expect(page, path).toHaveURL(home);
      }
    });
  });

  test.describe("4. the database refuses their token directly", () => {
    // The server-only-writes.spec.ts shape: a real Clerk session token for
    // this specific Technician login, called straight at PostgREST with the
    // anon key — the boundary under test is Clerk's claims meeting 0068's
    // restrictive policies, which a stubbed token or a mocked client proves
    // nothing about.
    test("GET for Assign Other returns [] — RLS hides it, never refuses it", async () => {
      const token = await mintClientToken(technicianClerkUserId);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/contacts?id=eq.${otherId}&select=id`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const text = await res.text();
      expect(res.status, text).toBe(200);
      expect(JSON.parse(text) as unknown[]).toEqual([]);
    });

    test("PATCH to unassign Assign Mine is refused (42501); it stays assigned", async () => {
      const token = await mintClientToken(technicianClerkUserId);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/contacts?id=eq.${mineId}&select=id`,
        {
          method: "PATCH",
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({ assigned_to: null }),
        },
      );
      const text = await res.text();
      // A Technician's own contact is theirs to SELECT (assigned_to = them),
      // but the row they're trying to WRITE no longer satisfies the same
      // policy's WITH CHECK (0068's contacts_technician_scope: "me" is the
      // only legal assigned_to before AND after their own update) — a
      // row-level-security violation, 42501, not a bare permission denial.
      expect(res.status, text).toBeGreaterThanOrEqual(400);
      const body = JSON.parse(text) as { code?: string };
      expect(body.code, text).toBe("42501");

      const db = serviceDb();
      const after = await db.from("contacts").select("assigned_to").eq("id", mineId).single();
      expect.soft(after.error, after.error?.message).toBeNull();
      expect.soft(after.data?.assigned_to, "Assign Mine after the refused PATCH").toBe(technicianUserId);
    });
  });
});
