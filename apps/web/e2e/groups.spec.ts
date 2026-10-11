import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, createContact } from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase and
// Clerk from the Playwright runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-02 part 1 (spec §9 e2e): an Owner builds a household on the per-run
 * fixture account, sets a role, main and pays, removes and Undoes; the
 * Business name edit reaches the list; and the Technician sees their own
 * customer's household but not the other member (G8). Never Test Client One.
 *
 * The two contacts this file seeds (`Groups Ana <stamp>`, `Groups Luis
 * <stamp>`) and the two groups it creates (`Familia <stamp>`, `Groups Biz
 * <stamp>`) are deleted in `afterAll`, with each delete's own error checked
 * rather than assumed. Neither group name starts with "E2E " — this file
 * cleans up its own rows explicitly rather than minting a name the sweep
 * would have to learn (fixtures/fixture-names.test.ts's walk).
 */
test.describe.configure({ timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
type Fixture = { accountId: string; clerkUserId: string; technicianUserId: string };

/**
 * Read at RUN TIME, never at module scope — Playwright collects every spec
 * file during COLLECTION, before the "setup" project has written this file
 * (assign.spec.ts's own doc comment explains the collection-time trap).
 */
function fixture(): Fixture {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (pnpm --filter web test:e2e).`);
  }
  const f = JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as Partial<Fixture>;
  if (!f.accountId || !f.clerkUserId || !f.technicianUserId) {
    throw new Error(`${FIXTURE_FILE} lacks the technician: run the full suite (pnpm --filter web test:e2e).`);
  }
  return f as Fixture;
}

const stamp = Date.now();
const HOUSEHOLD = `Familia ${stamp}`;
const BUSINESS = `Groups Biz ${stamp}`;
let accountId = "";
let anaId = "";
let luisId = "";

test.beforeAll(async () => {
  const f = fixture();
  accountId = f.accountId;
  const db = serviceDb();
  // Self-heal, same reasoning as assign.spec.ts's own beforeAll: this file
  // does not control run order against client-access.spec.ts.
  await setClientAccess(db, accountId, true, f.clerkUserId);
  anaId = (await createContact(db, accountId, { firstName: "Groups", lastName: `Ana ${stamp}`, assignedTo: f.technicianUserId }, "e2e-groups")).id;
  luisId = (await createContact(db, accountId, { firstName: "Groups", lastName: `Luis ${stamp}` }, "e2e-groups")).id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  for (const id of [anaId, luisId]) {
    if (!id) continue;
    const { error } = await db.from("contacts").delete().eq("id", id);
    expect(error, `deleting ${id}`).toBeNull();
  }
  const { error } = await db.from("client_groups").delete().eq("account_id", accountId).in("name", [HOUSEHOLD, BUSINESS]);
  expect(error, "deleting the probe groups").toBeNull();
});

test.describe.serial("S-02: households and the business name", () => {
  test.describe("the Owner", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("builds a household, sets role, main and pays, removes and Undoes", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${anaId}`);
      const card = page.locator("[data-groups-card]");
      await expect(card.getByText(m["groups.empty"])).toBeVisible();
      await card.getByRole("button", { name: m["groups.add"] }).click();
      await page.getByPlaceholder(m["groups.searchPlaceholder"]).fill(HOUSEHOLD);
      await page.getByRole("option", { name: m["groups.createHousehold"].replace("{name}", HOUSEHOLD) }).click();
      await expect(page.getByText(m["groups.added"].replace("{name}", HOUSEHOLD))).toBeVisible();
      await expect(card.getByText(m["groups.kind.household"])).toBeVisible();
      await expect(card.locator('[data-mark="primary"]')).toContainText(m["groups.primary"]);

      await card.getByRole("button", { name: new RegExp(`^${m["inline.edit"].replace("{label}", m["groups.role"])}`) }).click();
      await page.getByRole("textbox", { name: m["groups.role"] }).fill("Madre");
      await page.keyboard.press("Enter");
      await card.getByRole("button", { name: m["groups.billing"] }).click();
      await expect(card.locator('[data-mark="billing"]')).toContainText(m["groups.billing"]);

      const db = serviceDb();
      const row = await db.from("client_group_members").select("id, role, is_primary, is_billing").eq("contact_id", anaId).single();
      expect(row.error, row.error?.message).toBeNull();
      expect(row.data).toMatchObject({ role: "Madre", is_primary: true, is_billing: true });

      await card.getByRole("button", { name: `${m["groups.remove"]}: ${HOUSEHOLD}` }).click();
      const removedText = m["groups.removed"].replace("{name}", HOUSEHOLD);
      await expect(page.getByText(removedText)).toBeVisible();
      // Scoped to THIS toast: the role and pays saves left Undo toasts of their own on screen.
      await page.locator("[data-sonner-toast]").filter({ hasText: removedText })
        .getByRole("button", { name: m["common.undo"] }).click();
      await expect(card.getByText(HOUSEHOLD)).toBeVisible();
      const back = await db.from("client_group_members").select("id, role, is_billing").eq("contact_id", anaId).single();
      expect(back.data).toEqual({ id: row.data!.id, role: "Madre", is_billing: true });
    });

    test("adds the second person through search", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${luisId}`);
      const card = page.locator("[data-groups-card]");
      await card.getByRole("button", { name: m["groups.add"] }).click();
      await page.getByPlaceholder(m["groups.searchPlaceholder"]).fill(`Familia ${stamp}`.slice(0, 12));
      await page.getByRole("option", { name: new RegExp(HOUSEHOLD) }).first().click();
      await expect(card.getByText(`Ana ${stamp}`)).toBeVisible();
    });

    test("the Business name edit reaches the list column", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${luisId}`);
      await page.getByRole("button", { name: new RegExp(`^${m["inline.edit"].replace("{label}", m["contact.company"])}`) }).click();
      await page.getByRole("textbox", { name: m["contact.company"] }).fill(BUSINESS);
      await page.keyboard.press("Enter");
      await expect(page.getByText(m["inline.saved"].replace("{label}", m["contact.company"]))).toBeVisible();
      await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${encodeURIComponent(`Luis ${stamp}`)}`);
      await expect(page.locator("[data-contact-row]").filter({ hasText: `Luis ${stamp}` })).toContainText(BUSINESS);
    });
  });

  test.describe("the Technician", () => {
    test.use({ storageState: "e2e/.auth/technician-state.json" });

    test("sees their customer's household but not the other member (G8)", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${anaId}`);
      const card = page.locator("[data-groups-card]");
      await expect(card.getByText(HOUSEHOLD)).toBeVisible();     // positive control first
      await expect(card.getByText(`Luis ${stamp}`)).toHaveCount(0);
      await expect(card.getByText(m["groups.billingAddress"])).toHaveCount(0); // A6
    });
  });
});
