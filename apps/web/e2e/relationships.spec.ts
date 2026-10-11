import { test, expect, type Page } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, addRelationship, setClientAccess, type NewRelationship } from "@bis/db";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly, not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Relationships between customers (spec §9). Everything here runs on the PER-RUN fixture account
 * (auth.setup.ts creates it, auth.teardown.ts deletes it unconditionally) — never on `Test Client
 * One` (CLAUDE.md's hard rule): this spec ADDS relationships, toggles a flag and removes a row, all
 * mutations, and the seeded account is read-only (openAccountByName's own doc comment).
 *
 * WHAT IT SEEDS, and how it is cleaned up. The CHILD (the record the Owner steps open), the FOUND
 * customer (step 4's search target) and the three TECHNICIAN contacts (step 6) are made here with
 * serviceDb(), each with a stamped last name. Two people are made through the UI itself, on
 * purpose: the MOTHER (step 1, the dialog's "New person" path, the one spec §9 ships) and the AUNT
 * (step 5, the "New person" retry the dialog's finding-3 fix exists for: a failed add after the
 * person exists retries by id and never makes them twice). There is no id to hold onto for those
 * two until the dialog hands one back, so afterAll deletes EVERY contact this file made by its
 * stamped last name, checks the delete's error and then checks that none is left;
 * contact_relationships (0070) cascades off both contact_id and related_contact_id, so every row
 * the dialog wrote goes with them, which afterAll checks for the rows it has ids for.
 *
 * PER-PERSON STATE. Step 3 switches the fixture Owner's own users.language to Spanish and puts it
 * back in a `finally`, every read and write checked. Nothing else here changes a person's state.
 *
 * ORDER. describe.serial on purpose: step 2 edits and removes the exact row step 1 created, step 3
 * reads that same row again in Spanish, and steps 4-5 count the child's rows after them — out of
 * order, a step either finds nothing to assert against or asserts the wrong thing silently (the
 * reasoning assign.spec.ts's own header gives). Step 6 reads only its own seeded rows.
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
const ACTOR = "e2e-relationships";
const CHILD_LAST = `Child ${stamp}`;
const MOTHER_LAST = `Mother ${stamp}`;
const FOUND_LAST = `Found ${stamp}`;
const AUNT_LAST = `Aunt ${stamp}`;
const TECH_MINE_LAST = `TechMine ${stamp}`;
const TECH_TOO_LAST = `TechToo ${stamp}`;
const TECH_HIDDEN_LAST = `TechHidden ${stamp}`;
const ALL_LASTS = [CHILD_LAST, MOTHER_LAST, FOUND_LAST, AUNT_LAST, TECH_MINE_LAST, TECH_TOO_LAST, TECH_HIDDEN_LAST];
/** Every person here is first-named "E2E"; one literal, so the fixture-name walk sees one shape. */
const named = (last: string) => `E2E ${last}`;
/** Timestamp-unique on a fictional prefix (call-proposals.spec.ts's shape, its own prefix). */
const AUNT_PHONE = `+1557${String(stamp).slice(-7)}`;

const relationship = (contactId: string, relatedContactId: string, over: Partial<NewRelationship>): NewRelationship => ({
  contactId, relatedContactId, labelKey: "parent", customLabel: null, contactForm: null, relatedForm: null,
  contactCanPickUp: false, contactIsEmergency: false, relatedCanPickUp: false, relatedIsEmergency: false, ...over,
});

/** A sonner toast carrying this exact sentence (preferences.spec.ts's helper). */
const toastWithText = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

/**
 * The toast carrying `text`, hovered at once, as preferences.spec.ts does before its Undo: a hovered
 * sonner toast pauses its timer, so it is still there after the database poll that follows, and
 * its own Undo is the one clicked (a "Saved." toast may still be showing beside a "Removed").
 */
async function heldToast(page: Page, text: string) {
  const toast = toastWithText(page, text);
  await expect(toast).toBeVisible();
  await toast.hover();
  return toast;
}
const undoIn = (toast: Awaited<ReturnType<typeof heldToast>>) => toast.getByRole("button", { name: m["relationships.undo"] }).click();

let accountId = "";
let childId = "";
let foundId = "";
let techMineId = "";
let techTooId = "";
let techHiddenId = "";

test.beforeAll(async () => {
  const f = fixture();
  accountId = f.accountId;
  const db = serviceDb();
  // Self-heal, assign.spec.ts's reasoning: client-access.spec.ts runs earlier in a full run and
  // leaves client_access_enabled OFF until auth.teardown.ts, which would send both client logins
  // this file uses (Owner, Technician) to /no-access.
  await setClientAccess(db, accountId, true, f.clerkUserId);

  childId = (await createContact(db, accountId, { firstName: "E2E", lastName: CHILD_LAST }, ACTOR)).id;
  foundId = (await createContact(db, accountId, { firstName: "E2E", lastName: FOUND_LAST }, ACTOR)).id;
  // Step 6: two customers assigned to the per-run Technician and one who is not.
  techMineId = (await createContact(db, accountId, { firstName: "E2E", lastName: TECH_MINE_LAST, assignedTo: f.technicianUserId }, ACTOR)).id;
  techTooId = (await createContact(db, accountId, { firstName: "E2E", lastName: TECH_TOO_LAST, assignedTo: f.technicianUserId }, ACTOR)).id;
  techHiddenId = (await createContact(db, accountId, { firstName: "E2E", lastName: TECH_HIDDEN_LAST, assignedTo: null }, ACTOR)).id;
  // On TechMine's record: "Mother: someone not on your list" (the hidden one, side a, "f") and
  // "Sister: E2E TechToo …" (theirs, side a, "f").
  await addRelationship(db, accountId, relationship(techHiddenId, techMineId, { labelKey: "parent", contactForm: "f" }), ACTOR);
  await addRelationship(db, accountId, relationship(techTooId, techMineId, { labelKey: "sibling", contactForm: "f" }), ACTOR);
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  const { error } = await db.from("contacts").delete().eq("account_id", accountId).in("last_name", ALL_LASTS);
  expect(error, `deleting this spec's own contacts: ${error?.message}`).toBeNull();
  const left = await db.from("contacts").select("id").eq("account_id", accountId).in("last_name", ALL_LASTS);
  expect(left.error, `re-reading this spec's contacts: ${left.error?.message}`).toBeNull();
  expect(left.data, "contacts this spec made that are still there").toEqual([]);
  const ids = [childId, foundId, techMineId, techTooId, techHiddenId].filter(Boolean);
  if (ids.length === 0) return;
  const list = ids.join(",");
  const rows = await db.from("contact_relationships").select("id").eq("account_id", accountId)
    .or(`contact_id.in.(${list}),related_contact_id.in.(${list})`);
  expect(rows.error, `re-reading this spec's relationships: ${rows.error?.message}`).toBeNull();
  expect(rows.data, "relationships the contact cascade should have removed").toEqual([]);
});

test.describe.serial("relationships on the record", () => {
  test.describe("the Owner", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("1. an Owner adds a mother as a new person; both records read correctly", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
      const card = page.locator("[data-relationships-card]");
      // Positive control: the card's own empty state, before anything has been added — otherwise a
      // card that silently rendered nothing (or errored) would make every assertion after it
      // meaningless.
      await expect(card.getByText(m["relationships.empty"])).toBeVisible();

      await card.getByRole("button", { name: m["relationships.add"] }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: m["relationships.dialog.newPerson"] }).click();
      await dialog.getByLabel(m["relationships.dialog.firstName"]).fill("E2E");
      await dialog.getByLabel(m["relationships.dialog.lastName"]).fill(MOTHER_LAST);
      // "parent:a" picks the OTHER person's side of the "parent" label (Parent/Mother/Father); the
      // subject's own side (Child/Daughter/Son) is offered right under it the moment a label is
      // picked (relationship-labels.ts's formChoices, called once for "other" and once for
      // "subject"). Two distinct word sets, so "Mother" and "Son" each name exactly one radio.
      await dialog.locator("#rel-kind").selectOption("parent:a");
      await dialog.getByRole("radio", { name: "Mother" }).check();
      await dialog.getByRole("radio", { name: "Son" }).check();
      await dialog.getByRole("button", { name: m["relationships.dialog.submit"] }).click();
      await expect(card.getByText(`Mother: ${named(MOTHER_LAST)}`)).toBeVisible();

      const db = serviceDb();
      const read = await db.from("contact_relationships")
        .select("label_key, contact_form, related_form, contact_id, related_contact_id")
        .eq("account_id", accountId).eq("related_contact_id", childId);
      expect(read.error, read.error?.message).toBeNull();
      const rows = read.data ?? [];
      expect(rows).toHaveLength(1);
      // contact_id is the OTHER side ("a") for a parent:a add (relationship-view.ts's
      // newRelationshipFor): the mother, "f" for the Mother radio; related_contact_id is the
      // subject (the child), "m" for the Son radio.
      expect(rows[0]).toMatchObject({ label_key: "parent", contact_form: "f", related_form: "m" });
      // Hand-added (F-085 part 1, spec R4): the Owner's own write assigns the new contact at once,
      // never left Unassigned on a guess.
      const mother = await db.from("contacts").select("id, assigned_to").eq("id", rows[0]!.contact_id).single();
      expect(mother.error, mother.error?.message).toBeNull();
      expect(mother.data!.assigned_to).not.toBeNull();

      // The reciprocal: the SAME row, read from the mother's own record, in her own word.
      await card.getByRole("link", { name: `Mother: ${named(MOTHER_LAST)}` }).click();
      await expect(page.locator("[data-relationships-card]").getByText(`Son: ${named(CHILD_LAST)}`)).toBeVisible();
    });

    test("2. a flag saves at once with Undo; remove has Undo and restores the same row", async ({ page }) => {
      const db = serviceDb();
      const readRow = async () => {
        const r = await db.from("contact_relationships").select("id, contact_can_pick_up")
          .eq("account_id", accountId).eq("related_contact_id", childId);
        expect(r.error, r.error?.message).toBeNull();
        return r.data ?? [];
      };
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
      const chip = page.locator("[data-relationship-chip]").filter({ hasText: `Mother: ${named(MOTHER_LAST)}` });
      // Positive control: the row step 1 made is really on the page before this step's own writes
      // (the toggle, then the remove) are asked to prove anything about it.
      await expect(chip).toBeVisible();

      await chip.getByRole("button", { name: m["relationships.flag.canPickUp"] }).click();
      await expect(chip.getByRole("button", { name: m["relationships.flag.canPickUp"] }))
        .toHaveAttribute("aria-pressed", "true");
      const saved = await heldToast(page, m["relationships.saved"]);
      await expect.poll(async () => (await readRow())[0]?.contact_can_pick_up).toBe(true);
      await undoIn(saved);
      await expect.poll(async () => (await readRow())[0]?.contact_can_pick_up).toBe(false);

      const before = (await readRow())[0]!.id;
      await chip.getByRole("button", { name: m["relationships.remove"].replace("{name}", named(MOTHER_LAST)) }).click();
      const removed = await heldToast(page, m["relationships.removed"].replace("{name}", named(MOTHER_LAST)));
      await expect.poll(async () => (await readRow()).length).toBe(0);
      await undoIn(removed);
      await expect.poll(async () => (await readRow())[0]?.id).toBe(before);
    });

    test("3. a Spanish reader sees 'Madre:'", async ({ page }) => {
      const db = serviceDb();
      // Exactly one Owner membership exists on a per-run fixture account: the client fixture user is
      // the ONLY Clerk org:admin on its org (auth.setup.ts's `createdBy: user.id`), and
      // roleFromClerk (@bis/db/team.ts) answers "owner" only for org:admin with no demoting
      // bis_role metadata; Staff's own org:member answers "staff", and Technician is written
      // directly with that role. `.limit(1)` is therefore never hiding a second real Owner.
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
        await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
        await expect(page.locator('[data-relationships-card][lang="es"]').getByText(`Madre: ${named(MOTHER_LAST)}`))
          .toBeVisible();
      } finally {
        // Reset because every LATER spec in this same run uses this same per-run Owner (workers: 1,
        // playwright.config.ts) and asserts English copy: left in Spanish, it would fail them.
        const reset = await db.from("users").update({ language: priorLanguage }).eq("id", ownerId).select("id");
        expect(reset.error, `resetting the Owner's language: ${reset.error?.message}`).toBeNull();
        expect(reset.data, "resetting the Owner's language: one users row").toHaveLength(1);
      }
    });

    test("4. an Owner finds an existing customer through the dialog's search and relates them", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
      const card = page.locator("[data-relationships-card]");
      // Positive control: the card is loaded and showing step 1's row.
      await expect(card.getByText(`Mother: ${named(MOTHER_LAST)}`)).toBeVisible();

      await card.getByRole("button", { name: m["relationships.add"] }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(m["relationships.dialog.search"]).fill(FOUND_LAST);
      // The live answer, a round trip after the 250ms debounce.
      const hit = dialog.getByRole("radio", { name: named(FOUND_LAST) });
      await expect(hit).toBeVisible({ timeout: 15_000 });
      await hit.check();
      await dialog.locator("#rel-kind").selectOption("godparent:a");
      await dialog.getByRole("radio", { name: "Godmother" }).check();
      await dialog.getByRole("button", { name: m["relationships.dialog.submit"] }).click();
      await expect(card.getByText(`Godmother: ${named(FOUND_LAST)}`)).toBeVisible();

      const read = await serviceDb().from("contact_relationships").select("label_key, contact_form, related_form")
        .eq("account_id", accountId).eq("contact_id", foundId).eq("related_contact_id", childId);
      expect(read.error, read.error?.message).toBeNull();
      expect(read.data).toEqual([{ label_key: "godparent", contact_form: "f", related_form: null }]);
    });

    test("5. a second 'New person' with the same phone and label is a duplicate; the names lock, another label adds, and she exists once", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
      const card = page.locator("[data-relationships-card]");
      await expect(card.getByText(`Mother: ${named(MOTHER_LAST)}`)).toBeVisible(); // positive control
      const dialog = page.getByRole("dialog");
      const openNewPerson = async (kind: string) => {
        await card.getByRole("button", { name: m["relationships.add"] }).click();
        await dialog.getByRole("button", { name: m["relationships.dialog.newPerson"] }).click();
        await dialog.getByLabel(m["relationships.dialog.firstName"]).fill("E2E");
        await dialog.getByLabel(m["relationships.dialog.lastName"]).fill(AUNT_LAST);
        await dialog.getByLabel(m["relationships.dialog.phone"]).fill(AUNT_PHONE);
        await dialog.locator("#rel-kind").selectOption(kind);
        await dialog.getByRole("button", { name: m["relationships.dialog.submit"] }).click();
      };

      // First add: she is created and related.
      await openNewPerson("caregiver:a");
      await expect(card.getByText(`Caregiver: ${named(AUNT_LAST)}`)).toBeVisible();

      // Same phone, same label: the hand-add matches her, and the pair already exists.
      await openNewPerson("caregiver:a");
      await expect(toastWithText(page, m["relationships.error.duplicate"])).toBeVisible();
      await expect(dialog).toBeVisible();
      // The dialog now holds her id: the names are hers and cannot be retyped into someone new.
      for (const label of [m["relationships.dialog.firstName"], m["relationships.dialog.lastName"], m["relationships.dialog.phone"]]) {
        await expect(dialog.getByLabel(label)).toHaveAttribute("readonly", "");
      }
      // She was MATCHED, not created, so nothing claims this add saved her (final review item 7).
      await expect(dialog.locator('[data-relationship-note="person-saved"]')).toHaveText("");

      // Another label on the retry relates the same person.
      await dialog.locator("#rel-kind").selectOption("responsible_party:a");
      await dialog.getByRole("button", { name: m["relationships.dialog.submit"] }).click();
      await expect(dialog).toBeHidden();
      await expect(card.getByText(`Responsible party: ${named(AUNT_LAST)}`)).toBeVisible();

      const db = serviceDb();
      const people = await db.from("contacts").select("id").eq("account_id", accountId).eq("last_name", AUNT_LAST);
      expect(people.error, people.error?.message).toBeNull();
      expect(people.data, "contacts named Aunt <stamp>: made once, never twice").toHaveLength(1);
      const rows = await db.from("contact_relationships").select("label_key")
        .eq("account_id", accountId).eq("contact_id", people.data![0]!.id).eq("related_contact_id", childId)
        .order("label_key", { ascending: true });
      expect(rows.error, rows.error?.message).toBeNull();
      expect(rows.data!.map((r) => r.label_key)).toEqual(["caregiver", "responsible_party"]);
    });
  });

  test.describe("the Technician", () => {
    test.use({ storageState: "e2e/.auth/technician-state.json" });

    test("6. a related person who is not theirs reads as 'someone not on your list', with no name, link, control or id", async ({ page }) => {
      const route = `/api/accounts/${accountId}/contacts/${techMineId}/relationships`;
      const answered = page.waitForResponse((r) => new URL(r.url()).pathname === route);
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${techMineId}`);
      const res = await answered;
      const body = await res.text();
      expect(res.status(), body).toBe(200);
      // Positive controls first: the read names the person who IS theirs, and the page shows the
      // record's own customer and that person's chip as a link.
      expect(body).toContain(techTooId);
      await expect(page.getByText(named(TECH_MINE_LAST)).first()).toBeVisible();
      const card = page.locator("[data-relationships-card]");
      const sister = card.locator("[data-relationship-chip]").filter({ hasText: `Sister: ${named(TECH_TOO_LAST)}` });
      await expect(sister).toBeVisible();
      await expect(sister.getByRole("link")).toHaveCount(1);

      const hidden = card.locator("[data-relationship-chip]").filter({ hasText: `Mother: ${m["relationships.hiddenPerson"]}` });
      await expect(hidden).toBeVisible();
      await expect(hidden.getByRole("link")).toHaveCount(0);
      await expect(hidden.getByRole("button")).toHaveCount(0);
      await expect(hidden.getByText(m["relationships.askTeam"])).toBeVisible();

      // Neither the read nor the page carries the hidden person's id or name (spec C5).
      expect(body).not.toContain(techHiddenId);
      expect(body).not.toContain(TECH_HIDDEN_LAST);
      const html = await page.content();
      expect(html).toContain(techTooId); // control: a visible person's id IS in the page (the chip's link)
      expect(html).not.toContain(techHiddenId);
      expect(html).not.toContain(TECH_HIDDEN_LAST);
    });
  });
});
