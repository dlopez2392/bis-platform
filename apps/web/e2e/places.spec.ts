import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, createContact, createGroupWithMember, addContactToGroup, addPlace, type PlaceFields } from "@bis/db";
import { m } from "../src/lib/messages";
import { formatDateUTC } from "../src/lib/format";
import { recordPage } from "./support";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly, not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-02 B2 (spec section 8 / 2026-10-11-places-and-equipment-design.md): properties and equipment on
 * a contact's own record. Everything here runs on the PER-RUN fixture account (auth.setup.ts creates
 * it, auth.teardown.ts deletes it unconditionally) — never on `Test Client One` (CLAUDE.md's hard
 * rule): every test here mutates (adds, edits, removes, replaces), and the seeded account is
 * read-only (openAccountByName's own doc comment).
 *
 * WHAT IT SEEDS, and how it is cleaned up. Four contacts (the RECORD the Owner works from, a SECOND
 * contact for the household-share check, and two Technician contacts — TECH_MINE, assigned to the
 * per-run Technician, and TECH_OTHER, not) are made here with serviceDb(), each with a stamped last
 * name; afterAll deletes every contact this file made by its stamped last name, checks the delete's
 * error and then re-reads to confirm none is left. Two client_groups rows (a household for RECORD +
 * SECOND, and one for TECH_MINE) are made directly by id and deleted by id in afterAll — a group is
 * not owned by any one contact, so no contact's cascade removes it. Every PLACE this file's tests
 * create (through the UI or seeded directly) hangs off either a contact_id this file deletes or a
 * client_group_id this file deletes, and every unit hangs off one of those places — both places and
 * equipment go by CASCADE (packages/db's places-schema tests pin it: a contact delete takes the
 * places only it owns, with their equipment, chain included; a group delete takes its own places the
 * same way). afterAll therefore snapshots every place id reachable through this file's contacts or
 * groups BEFORE deleting either, then re-reads both `places` and `equipment` by those ids afterward
 * and checks each list is empty — the cascade check the ids it holds, rather than one id at a time.
 *
 * ORDER. describe.serial on purpose: test 2 replaces the exact unit test 1 (sic — test "2.") added,
 * test "3." removes and restores rows tests "1." and "2." left behind, test "4." reads the SAME
 * record again to add a household-shared property, and test "5." reads it again in Spanish — out of
 * order, a later step either finds nothing to assert against or asserts the wrong thing silently
 * (the reasoning assign.spec.ts's and relationships.spec.ts's own headers give).
 *
 * MUTATION PROBE (Task 7 step 5 — static, no Playwright; the orchestrator's run is the real
 * red/green; corrected after final review — the first draft mis-attributed the 404 below). In test
 * "6.": the 404 for `techOtherId`'s route and the absence of `TECH_OTHER_ADDRESS` from the page and
 * from `techMineId`'s OWN route body are an APP-PATH proof, not a `places_technician_scope` proof —
 * the places route's `getContact` (route.ts) refuses an unreadable CONTACT before `listContactPlaces`
 * or any places policy ever runs, so dropping `places_technician_scope` would not touch either
 * assertion: a Technician's request client already cannot read `techOtherId` at all (0068's contacts
 * fence), for a reason unrelated to places. What dropping `places_technician_scope` WOULD break is
 * narrower and not exercised here — a Technician reading a place belonging to a CUSTOMER THEY CAN
 * SEE but that is not theirs — which is `places-rls.test.ts`'s job (packages/db), seeded so the
 * Technician's reach is tested against a real, visible customer's place, not a contact they cannot
 * open in the first place. If `PlacesCardView` ignored `canMovePlace` (rendered "Belongs to"
 * regardless), `expect(card.getByText(m["places.belongsTo"])).toHaveCount(0)` in test "6." would
 * fail, because the line would be there — that probe stands as originally written.
 */
test.describe.configure({ timeout: 60_000 });

type ClientFixture = { accountId: string; clerkUserId: string; technicianUserId?: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";

/**
 * Read at RUN TIME, never at module scope (Playwright collects every spec before the "setup"
 * project writes this file; assign.spec.ts's own fixture() says the same). A missing fixture FAILS,
 * naming the fix: a skip would be a green that never ran.
 */
function fixture(): ClientFixture & { technicianUserId: string } {
  if (!existsSync(FIXTURE_FILE)) {
    throw new Error(`client fixture missing at ${FIXTURE_FILE}: the "setup" project did not run. Run the full suite: pnpm --filter web test:e2e.`);
  }
  const parsed = JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
  if (!parsed.accountId || !parsed.clerkUserId || !parsed.technicianUserId) {
    throw new Error(`${FIXTURE_FILE} lacks accountId, clerkUserId or technicianUserId: "authenticate as technician user" (auth.setup.ts) did not run. Run the full suite.`);
  }
  return parsed as ClientFixture & { technicianUserId: string };
}

const stamp = Date.now();
const ACTOR = "e2e-places";
// "Places" first names, not "E2E" (groups.spec.ts's own convention): a stamped, interpolated name
// starting with the other prefix would be a NEW, unexplained shape to fixtures/fixture-names.test.ts's
// walk; contacts have no name-based sweep leg of their own regardless (they ride their account's
// cascade), so there is nothing to gain by inviting that walk to look at this file.
const RECORD_LAST = `Record ${stamp}`;
const SECOND_LAST = `Second ${stamp}`;
const TECH_MINE_LAST = `TechMine ${stamp}`;
const TECH_OTHER_LAST = `TechOther ${stamp}`;
const ALL_LASTS = [RECORD_LAST, SECOND_LAST, TECH_MINE_LAST, TECH_OTHER_LAST];

const LANDMARK = `Blue house past the canal ${stamp}`;
const DIRECTIONS = "Past the Valero, second gate on the left.";
const ADDRESS = `100 Places Ave, stamp ${stamp}`;
const SECOND_PLACE_ADDRESS = `200 Second Property Rd, stamp ${stamp}`;
const HOUSEHOLD = `Places Familia ${stamp}`;
const SHARED_ADDRESS = `300 Shared Household Way, stamp ${stamp}`;
const TECH_HOUSEHOLD = `Places Tech Familia ${stamp}`;
const TECH_SHARED_ADDRESS = `400 Tech Shared St, stamp ${stamp}`;
const TECH_OTHER_ADDRESS = `500 Other Customer Dr, stamp ${stamp}`;
const TECH_LANDMARK = `Tech edited landmark ${stamp}`;
const UNIT_NAME = "AC upstairs";
// Comfortably future and comfortably after the 2019 install date; never compared to "today" for
// warranty order, only to installed_on (equipment_warranty_order).
const WARRANTY_UNTIL = "2099-12-30";

const EMPTY_PLACE_FIELDS: PlaceFields = {
  label: null, address: null, landmark: null, directions: null, city: null, region: null, postal_code: null, country: null,
};
const placeFields = (over: Partial<PlaceFields>): PlaceFields => ({ ...EMPTY_PLACE_FIELDS, ...over });

/** A sonner toast carrying this exact sentence (preferences.spec.ts's / relationships.spec.ts's helper). */
const toastWithText = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

/**
 * The toast carrying `text`, hovered at once: a hovered sonner toast pauses its timer, so it is still
 * there after whatever the caller does next, and its own Undo is the one clicked (a second toast —
 * e.g. an "Added …" toast still showing beside a "Removed …" one — may be on screen too).
 */
async function heldToast(page: Page, text: string) {
  const toast = toastWithText(page, text);
  await expect(toast).toBeVisible();
  await toast.hover();
  return toast;
}
const undoIn = (toast: Awaited<ReturnType<typeof heldToast>>) => toast.getByRole("button", { name: m["common.undo"] }).click();

/** The inline field's at-rest button: its accessible name is "Edit {label}: {value}" — only the
 *  prefix is stable across a changing value, so every caller anchors on it rather than matching whole. */
const editButton = (scope: ReturnType<Page["locator"]>, label: string) =>
  scope.getByRole("button", { name: new RegExp(`^${m["inline.edit"].replace("{label}", label)}`) });

let accountId = "";
let recordId = "";
let secondId = "";
let techMineId = "";
let techOtherId = "";
let householdId = "";
let techHouseholdId = "";

test.beforeAll(async () => {
  const f = fixture();
  accountId = f.accountId;
  const db = serviceDb();
  // Self-heal, assign.spec.ts's reasoning: client-access.spec.ts runs earlier in a full run and
  // leaves client_access_enabled OFF until auth.teardown.ts, which would send both client logins
  // this file uses (Owner, Technician) to /no-access.
  await setClientAccess(db, accountId, true, f.clerkUserId);

  recordId = (await createContact(db, accountId, { firstName: "Places", lastName: RECORD_LAST }, ACTOR)).id;
  secondId = (await createContact(db, accountId, { firstName: "Places", lastName: SECOND_LAST }, ACTOR)).id;
  techMineId = (await createContact(db, accountId, { firstName: "Places", lastName: TECH_MINE_LAST, assignedTo: f.technicianUserId }, ACTOR)).id;
  techOtherId = (await createContact(db, accountId, { firstName: "Places", lastName: TECH_OTHER_LAST, assignedTo: null }, ACTOR)).id;

  // The Technician's household (test "6."): a shared property reachable only through group
  // membership, the harder half of places_technician_scope's reach (the schema test's own words:
  // "their customer's place AND their customer's household's place").
  const group = await createGroupWithMember(db, accountId, techMineId, "household", TECH_HOUSEHOLD, null, ACTOR);
  if (group.status !== "ok") throw new Error(`seeding the Technician's household failed: ${group.status}`);
  techHouseholdId = group.groupId;
  await addPlace(db, accountId, { contactId: null, groupId: techHouseholdId }, placeFields({ address: TECH_SHARED_ADDRESS }), { subjectId: techMineId, actorId: ACTOR });
  // The other customer's OWN property: what must never leak onto TECH_MINE's page or route.
  await addPlace(db, accountId, { contactId: techOtherId, groupId: null }, placeFields({ address: TECH_OTHER_ADDRESS }), { subjectId: techOtherId, actorId: ACTOR });
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const contactIds = [recordId, secondId, techMineId, techOtherId].filter(Boolean);
  const groupIds = [householdId, techHouseholdId].filter(Boolean);

  // Snapshot every place this file's contacts or groups own BEFORE either goes away, so the cascade
  // can be checked by id afterward rather than assumed.
  let placeIds: string[] = [];
  if (contactIds.length > 0 || groupIds.length > 0) {
    const clauses = [
      contactIds.length > 0 ? `contact_id.in.(${contactIds.join(",")})` : null,
      groupIds.length > 0 ? `client_group_id.in.(${groupIds.join(",")})` : null,
    ].filter((c): c is string => c !== null);
    const snap = await db.from("places").select("id").eq("account_id", accountId).or(clauses.join(","));
    expect(snap.error, `snapshotting this spec's places before cleanup: ${snap.error?.message}`).toBeNull();
    placeIds = (snap.data ?? []).map((p) => p.id as string);
  }

  if (contactIds.length > 0) {
    const { error } = await db.from("contacts").delete().eq("account_id", accountId).in("last_name", ALL_LASTS);
    expect(error, `deleting this spec's own contacts: ${error?.message}`).toBeNull();
    const left = await db.from("contacts").select("id").eq("account_id", accountId).in("last_name", ALL_LASTS);
    expect(left.error, `re-reading this spec's contacts: ${left.error?.message}`).toBeNull();
    expect(left.data, "contacts this spec made that are still there").toEqual([]);
  }
  if (groupIds.length > 0) {
    const { error } = await db.from("client_groups").delete().eq("account_id", accountId).in("id", groupIds);
    expect(error, `deleting this spec's groups: ${error?.message}`).toBeNull();
  }
  if (placeIds.length > 0) {
    const leftPlaces = await db.from("places").select("id").eq("account_id", accountId).in("id", placeIds);
    expect(leftPlaces.error, `re-reading this spec's places: ${leftPlaces.error?.message}`).toBeNull();
    expect(leftPlaces.data, "places this spec made that the contact/group cascade should have removed").toEqual([]);
    const leftEquip = await db.from("equipment").select("id").eq("account_id", accountId).in("place_id", placeIds);
    expect(leftEquip.error, `re-reading this spec's equipment: ${leftEquip.error?.message}`).toBeNull();
    expect(leftEquip.data, "equipment this spec made that the place cascade should have removed").toEqual([]);
  }
});

test.describe.serial("properties and equipment on the record (S-02 B2)", () => {
  test.describe("the Owner", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("1. adds a property with only a landmark and directions; the address edit reveals Open map", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${recordId}`);
      const card = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      // Positive control: the card's own empty state, before anything has been added.
      await expect(card.getByText(m["places.empty"])).toBeVisible();

      await card.getByRole("button", { name: m["places.add"] }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(m["places.landmark"]).fill(LANDMARK);
      await dialog.getByLabel(m["places.directions"]).fill(DIRECTIONS);
      await dialog.getByRole("button", { name: m["places.dialog.add"] }).click();
      await expect(dialog).toBeHidden();

      const row = card.locator("[data-place-row]").filter({ hasText: LANDMARK });
      await expect(row).toBeVisible();
      // The landmark field's OWN inline button, not the row's h4 title (which shows the same text
      // right now — no address yet, so placeTitle falls back to the landmark): two elements would
      // otherwise satisfy a bare getByText(LANDMARK) and violate strict mode.
      await expect(editButton(row, m["places.landmark"])).toHaveText(LANDMARK);
      await expect(row.getByText(DIRECTIONS)).toBeVisible();
      // No address yet: no map link to open.
      await expect(row.locator("[data-place-map]")).toHaveCount(0);

      await editButton(row, m["places.address"]).click();
      const addressInput = row.getByRole("textbox", { name: m["places.address"] });
      await addressInput.fill(ADDRESS);
      await addressInput.press("Enter");
      await expect(page.getByText(m["inline.saved"].replace("{label}", m["places.address"]))).toBeVisible();

      const map = row.locator("[data-place-map]");
      await expect(map).toBeVisible();
      await expect(map).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    });

    test("2. adds equipment under warranty; replaces it, with history, and Undo restores it", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${recordId}`);
      const card = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      const row = card.locator("[data-place-row]").filter({ hasText: LANDMARK });
      await expect(row).toBeVisible(); // positive control: test 1's property is still here
      const placeId = await row.getAttribute("data-place-row");

      await row.locator("[data-place-equipment]").getByRole("button", { name: m["equipment.add"] }).click();
      const addDialog = page.getByRole("dialog");
      await addDialog.getByLabel(m["equipment.name"]).fill(UNIT_NAME);
      await addDialog.getByLabel(m["equipment.make"]).fill("Trane");
      await addDialog.getByLabel(m["equipment.installDate"]).fill("2019-03-03");
      await addDialog.getByLabel(m["equipment.warrantyUntil"]).fill(WARRANTY_UNTIL);
      await addDialog.getByRole("button", { name: m["places.dialog.add"] }).click();
      await expect(addDialog).toBeHidden();

      const unitRow = row.locator("[data-unit-row]").filter({ hasText: UNIT_NAME });
      await expect(unitRow).toBeVisible();
      await expect(unitRow.locator('[data-mark="warranty"]'))
        .toHaveText(m["equipment.underWarranty"].replace("{date}", formatDateUTC(WARRANTY_UNTIL, "en")));

      // Replace it with "Carrier": the old unit (Trane/AC upstairs) goes into its history.
      const replaceTrigger = unitRow.getByRole("button", { name: m["equipment.replaceTitle"].replace("{name}", UNIT_NAME) });
      await replaceTrigger.click();
      const replaceDialog = page.getByRole("dialog");
      await replaceDialog.getByLabel(m["equipment.name"]).fill("Carrier");
      await replaceDialog.getByRole("button", { name: m["equipment.replace"] }).click();
      await expect(replaceDialog).toBeHidden();

      const carrierRow = row.locator("[data-unit-row]").filter({ hasText: "Carrier" });
      await expect(carrierRow).toBeVisible();
      const db = serviceDb();
      // Scoped to THIS place, not just this account: "Carrier" is a plain literal, not a stamped name,
      // so an unscoped lookup would resolve to whichever "Carrier" row exists anywhere on the account.
      const carrier = await db.from("equipment").select("id, installed_on").eq("account_id", accountId).eq("place_id", placeId).eq("name", "Carrier").single();
      expect(carrier.error, `reading the new Carrier unit: ${carrier.error?.message}`).toBeNull();
      const replacedOn = carrier.data!.installed_on as string;
      const historyToggle = carrierRow.getByRole("button", { name: m["equipment.history"].replace("{count}", "1") });
      await expect(historyToggle).toBeVisible();
      await historyToggle.click();
      await expect(carrierRow.locator("[data-equipment-history] li"))
        .toHaveText(`${UNIT_NAME} · Trane · ${m["equipment.installedOn"].replace("{date}", formatDateUTC("2019-03-03", "en"))} · ${m["equipment.replacedOn"].replace("{date}", formatDateUTC(replacedOn, "en"))}`);

      // Undo the replace: Carrier goes, AC upstairs/Trane is current again with no history.
      const replacedToast = await heldToast(page, m["equipment.replaced"]);
      await undoIn(replacedToast);
      await expect(row.locator("[data-unit-row]").filter({ hasText: "Carrier" })).toHaveCount(0);
      const acRow = row.locator("[data-unit-row]").filter({ hasText: UNIT_NAME });
      await expect(acRow).toBeVisible();
      await expect(acRow.getByRole("button", { name: /^Earlier units/ })).toHaveCount(0);
    });

    test("3. removes the current unit with Undo; removes an empty property with Undo; archives and puts back the one with equipment", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${recordId}`);
      const card = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      const row = card.locator("[data-place-row]").filter({ hasText: LANDMARK });
      const unitRow = row.locator("[data-unit-row]").filter({ hasText: UNIT_NAME });
      await expect(unitRow).toBeVisible(); // positive control: test 2's restored unit is still here

      // 3a. The current unit, nothing replacing it: remove, then Undo brings it back.
      await unitRow.getByRole("button", { name: m["equipment.removeAria"].replace("{name}", UNIT_NAME) }).click();
      const removedUnitToast = await heldToast(page, m["equipment.removed"].replace("{name}", UNIT_NAME));
      await expect(row.locator("[data-unit-row]")).toHaveCount(0);
      await undoIn(removedUnitToast);
      await expect(row.locator("[data-unit-row]").filter({ hasText: UNIT_NAME })).toBeVisible();

      // 3b. A second, EMPTY property: add it (positive control), remove it (deleted, not archived —
      // it has no equipment), then Undo restores the same row.
      await card.getByRole("button", { name: m["places.add"] }).click();
      const dialog2 = page.getByRole("dialog");
      await dialog2.getByLabel(m["places.address"]).fill(SECOND_PLACE_ADDRESS);
      await dialog2.getByRole("button", { name: m["places.dialog.add"] }).click();
      await expect(dialog2).toBeHidden();
      const row2 = card.locator("[data-place-row]").filter({ hasText: SECOND_PLACE_ADDRESS });
      await expect(row2).toBeVisible();

      await row2.getByRole("button", { name: m["places.removeAria"].replace("{name}", SECOND_PLACE_ADDRESS) }).click();
      const removedPlaceToast = await heldToast(page, m["places.removed"].replace("{place}", SECOND_PLACE_ADDRESS));
      await expect(card.locator("[data-place-row]").filter({ hasText: SECOND_PLACE_ADDRESS })).toHaveCount(0);
      await undoIn(removedPlaceToast);
      await expect(card.locator("[data-place-row]").filter({ hasText: SECOND_PLACE_ADDRESS })).toBeVisible();

      // 3c. The property WITH equipment: remove archives it (equipment count > 0), moving it under
      // "Removed properties (1)"; Put back makes it active again. Its TITLE (what the remove button's
      // aria-label, the archived toast and the removed-list row all carry — placeTitle's own fallback
      // order) is ADDRESS, not LANDMARK, from test "1." onward: an address outranks a landmark, and
      // test "1." gave it one. The removed list renders only the title text, so a LANDMARK-based
      // lookup there would match nothing at all, not merely the wrong row.
      await row.getByRole("button", { name: m["places.removeAria"].replace("{name}", ADDRESS) }).click();
      await heldToast(page, m["places.archived"].replace("{place}", ADDRESS));
      await expect(card.locator("[data-place-row]").filter({ hasText: LANDMARK })).toHaveCount(0);
      const removedToggle = card.getByRole("button", { name: m["places.removedList"].replace("{count}", "1") });
      await expect(removedToggle).toBeVisible();
      await removedToggle.click();
      const removedRow = card.locator("[data-places-removed] li").filter({ hasText: ADDRESS });
      await expect(removedRow).toBeVisible();
      await removedRow.getByRole("button", { name: m["places.putBack"] }).click();
      await expect(card.locator("[data-place-row]").filter({ hasText: LANDMARK })).toBeVisible();
    });

    test("4. a property belonging to a household reads as 'Shared with …' on both members' records", async ({ page }) => {
      const db = serviceDb();
      const group = await createGroupWithMember(db, accountId, recordId, "household", HOUSEHOLD, null, ACTOR);
      expect(group.status, `creating the household: ${group.status}`).toBe("ok");
      householdId = group.status === "ok" ? group.groupId : "";

      // The SECOND member: createGroupWithMember only adds recordId. Without this, secondId is never
      // in the household at all, and the drawer check below cannot find the shared property because
      // there is nothing making it SECOND's household to find it through.
      const added = await addContactToGroup(db, accountId, secondId, householdId, null, ACTOR);
      expect(added.status, `adding the second member to the household: ${added.status}`).toBe("ok");
      // Checked before navigating anywhere: a membership row that failed to land would otherwise only
      // surface later, as a confusing "not visible on the drawer" failure far from its real cause.
      const membership = await db.from("client_group_members").select("id")
        .eq("account_id", accountId).eq("client_group_id", householdId).eq("contact_id", secondId).maybeSingle();
      expect(membership.error, `reading the second member's membership: ${membership.error?.message}`).toBeNull();
      expect(membership.data, "the second member's membership row").not.toBeNull();

      await page.goto(`/dashboard/accounts/${accountId}/contacts/${recordId}`);
      const card = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      await card.getByRole("button", { name: m["places.add"] }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(m["places.address"]).fill(SHARED_ADDRESS);
      await dialog.getByLabel(m["places.belongsTo"]).selectOption({ label: m["places.sharedWith"].replace("{group}", HOUSEHOLD) });
      await dialog.getByRole("button", { name: m["places.dialog.add"] }).click();
      await expect(dialog).toBeHidden();

      const sharedRow = card.locator("[data-place-row]").filter({ hasText: SHARED_ADDRESS });
      await expect(sharedRow).toBeVisible();
      await expect(sharedRow.getByRole("paragraph").filter({ hasText: m["places.sharedWith"].replace("{group}", HOUSEHOLD) })).toBeVisible();

      // The household's SECOND member sees the same place on their own record (the drawer no longer
      // carries Properties, S-03 part 3 D7).
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${secondId}`);
      const secondCard = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      const sharedOnSecond = secondCard.locator("[data-place-row]").filter({ hasText: SHARED_ADDRESS });
      await expect(sharedOnSecond).toBeVisible();
      await expect(sharedOnSecond.getByRole("paragraph").filter({ hasText: m["places.sharedWith"].replace("{group}", HOUSEHOLD) })).toBeVisible();
    });

    test("5. a Spanish reader sees 'Propiedades', 'Cómo llegar' and 'Equipo'", async ({ page }) => {
      const db = serviceDb();
      // Exactly one Owner membership on a per-run fixture account (relationships.spec.ts's own
      // reasoning: the client fixture user is the ONLY Clerk org:admin on its org).
      const owner = await db.from("memberships").select("user_id")
        .eq("scope", "account").eq("account_id", accountId).eq("role", "owner").limit(1).single();
      expect(owner.error, `reading the fixture Owner's membership: ${owner.error?.message}`).toBeNull();
      const ownerId = owner.data!.user_id as string;
      const prior = await db.from("users").select("language").eq("id", ownerId).single();
      expect(prior.error, `reading the Owner's language before the switch: ${prior.error?.message}`).toBeNull();
      const priorLanguage = prior.data!.language as string | null;
      const set = await db.from("users").update({ language: "es" }).eq("id", ownerId).select("id");
      expect(set.error, `switching the Owner to Spanish: ${set.error?.message}`).toBeNull();
      expect(set.data, "switching the Owner to Spanish: one users row").toHaveLength(1);
      try {
        await page.goto(`/dashboard/accounts/${accountId}/contacts/${recordId}`);
        const card = recordPage(page).locator('[data-record-card="properties"] [data-places-card][lang="es"]');
        await expect(card.getByText(m["places.title.es"])).toBeVisible();
        await expect(card.getByText(m["places.directions.es"]).first()).toBeVisible();
        await expect(card.getByText(/Equipo/).first()).toBeVisible();
      } finally {
        // Reset because every LATER spec in this same run uses this same per-run Owner (workers: 1,
        // playwright.config.ts) and asserts English copy.
        const reset = await db.from("users").update({ language: priorLanguage }).eq("id", ownerId).select("id");
        expect(reset.error, `resetting the Owner's language: ${reset.error?.message}`).toBeNull();
        expect(reset.data, "resetting the Owner's language: one users row").toHaveLength(1);
      }
    });
  });

  test.describe("the Technician", () => {
    test.use({ storageState: "e2e/.auth/technician-state.json" });

    test("6. edits their customer's shared household property and adds a unit, with no 'Belongs to'; another customer's property never appears", async ({ page }) => {
      const route = `/api/accounts/${accountId}/contacts/${techMineId}/places`;
      const answered = page.waitForResponse((r) => new URL(r.url()).pathname === route);
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${techMineId}`);
      const res = await answered;
      const body = await res.text();
      expect(res.status(), body).toBe(200);
      // APP-PATH check: even the Technician's own SUCCESSFUL read, for a customer they really can
      // see, never carries the other customer's address — this route never queried for it (it reads
      // only this contact's own places and this contact's own groups' places, §6), so a leak here
      // would be the route pulling in rows it never meant to select, not an RLS gap.
      expect(body).not.toContain(TECH_OTHER_ADDRESS);

      const card = recordPage(page).locator('[data-record-card="properties"] [data-places-card]');
      const sharedRow = card.locator("[data-place-row]").filter({ hasText: TECH_SHARED_ADDRESS });
      // Positive control: the Technician sees their own customer's (shared, household) property.
      await expect(sharedRow).toBeVisible();
      // No "Belongs to" anywhere on the card: canMovePlace is false for a Technician.
      await expect(card.getByText(m["places.belongsTo"])).toHaveCount(0);

      await editButton(sharedRow, m["places.landmark"]).click();
      const landmarkInput = sharedRow.getByRole("textbox", { name: m["places.landmark"] });
      await landmarkInput.fill(TECH_LANDMARK);
      await landmarkInput.press("Enter");
      await expect(page.getByText(m["inline.saved"].replace("{label}", m["places.landmark"]))).toBeVisible();

      await sharedRow.locator("[data-place-equipment]").getByRole("button", { name: m["equipment.add"] }).click();
      const eqDialog = page.getByRole("dialog");
      await eqDialog.getByLabel(m["equipment.name"]).fill("Water heater");
      await eqDialog.getByRole("button", { name: m["places.dialog.add"] }).click();
      await expect(eqDialog).toBeHidden();
      await expect(sharedRow.locator("[data-unit-row]").filter({ hasText: "Water heater" })).toBeVisible();

      // APP-PATH checks, both: the OTHER customer's own route 404s — getContact (route.ts) refuses an
      // unreadable contact before listContactPlaces or any places policy runs, so this is the contacts
      // fence (0068) acting through the route, not places_technician_scope — and the page this
      // Technician IS allowed to see never renders what it never fetched.
      const otherRes = await page.request.get(`/api/accounts/${accountId}/contacts/${techOtherId}/places`);
      expect(otherRes.status()).toBe(404);
      const html = await page.content();
      expect(html).not.toContain(TECH_OTHER_ADDRESS);
    });
  });
});
