import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, createGroupWithMember, addContactToGroup } from "@bis/db";
import { m } from "../src/lib/messages";
import { recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-03 part 2, 2a (spec §11.1): the household page, opened BY URL (2a ships no link to it, R2).
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One (CLAUDE.md). Three contacts "<First>
 * García <stamp>" with random phones and the household "Familia García <stamp>" (never "E2E …":
 * this file deletes its own rows, fixture-names.test.ts needs no admission; groups.spec's
 * precedent). afterAll deletes the group (its memberships cascade) then the contacts, each error
 * checked.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): { accountId: string; clerkUserId: string } => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite (the "setup" project).`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8"));
};
const stamp = Date.now();
const ACTOR = "e2e-group-page";
const LAST = `García ${stamp}`;
const phone = () => `+1956292${String(Math.floor(Math.random() * 9000) + 1000)}`;
const made: { ana?: string; luis?: string; maria?: string; group?: string } = {};
const url = (q = "") => `/dashboard/accounts/${fixture().accountId}/groups/${made.group}${q}`;

test.beforeAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  for (const first of ["Ana", "Luis", "Maria"] as const) {
    const c = await createContact(db, accountId, { firstName: first, lastName: LAST, phone: phone() }, ACTOR);
    if (c.existing) throw new Error(`group-page e2e: ${first} matched an existing contact; refusing to use (or delete) it.`);
    made[first.toLowerCase() as "ana" | "luis" | "maria"] = c.id;
  }
  const g = await createGroupWithMember(db, accountId, made.ana!, "household", `Familia ${LAST}`, null, ACTOR);
  if (g.status !== "ok") throw new Error(`group-page e2e: ${g.status}`);
  made.group = g.groupId;
  for (const id of [made.luis!, made.maria!]) {
    const r = await addContactToGroup(db, accountId, id, g.groupId, null, ACTOR);
    if (r.status !== "ok") throw new Error(`group-page e2e: ${r.status}`);
  }
});

test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`group-page e2e: ${label} cleanup failed (the fixture sweep takes it): ${error.message}`);
  };
  if (made.group) await step("group", () => db.from("client_groups").delete().eq("account_id", accountId).eq("id", made.group!));
  const ids = [made.ana, made.luis, made.maria].filter((x): x is string => Boolean(x));
  await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", ids));
  const { data: left } = await db.from("contacts").select("id").in("id", ids);
  expect(left ?? []).toEqual([]);
});

test("asks who we call first, then Call Ana is the one primary, and Undo puts the question back (R1, D4)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url());
  const rec = recordPage(page);
  await expect(rec.locator("h1")).toHaveText(`Familia ${LAST}`);
  await expect(rec.locator("[data-people-prompt]")).toHaveText(m["groupPage.people.choosePrimary"]);
  await expect(rec.locator('[data-record-action="call"]')).toHaveCount(0);
  const anaRow = rec.locator(`[data-people-row]`, { hasText: `Ana ${LAST}` });
  await anaRow.getByRole("button", { name: m["groupPage.people.makePrimaryContact"] }).click();
  await expect(page.getByText(m["groupPage.people.primaryContactSet"].replace("{name}", `Ana ${LAST}`))).toBeVisible();
  const call = rec.locator('[data-record-action="call"]');
  await expect(call).toHaveText(m["groupPage.action.call"].replace("{name}", "Ana"));
  await expect(rec.locator('[data-record-actions] [data-variant="default"]')).toHaveCount(1);
  await expect(call).toHaveAttribute("data-variant", "default");
  // The fixture account has no approved A2P registration (record-page.spec.ts:190): no Text.
  await expect(rec.locator('[data-record-action="text"]')).toHaveCount(0);
  await expect(rec.locator("[data-people-prompt]")).toHaveCount(0);
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(rec.locator("[data-people-prompt]")).toBeVisible();
  await expect(rec.locator('[data-record-action="call"]')).toHaveCount(0);
});

test("lists the three people and each name opens that person", async ({ page }) => {
  await page.goto(url());
  const rec = recordPage(page);
  await expect(rec.locator("[data-people-name]")).toHaveText([`Ana ${LAST}`, `Luis ${LAST}`, `Maria ${LAST}`]);
  await rec.locator("[data-people-name]", { hasText: `Luis ${LAST}` }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${made.luis}$`));
});

test("at 390px Properties and Deals are closed, above People (spec §7's phone order; plan deviation 13)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url());
  const rec = recordPage(page);
  const order = await rec.locator("[data-record-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-record-card")));
  expect(order).toEqual(["properties", "deals", "people", "details"]);
  for (const id of ["properties", "deals"]) {
    await expect(rec.locator(`[data-record-card="${id}"] h2 > button[aria-expanded]`)).toHaveAttribute("aria-expanded", "false");
  }
});
