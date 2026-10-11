import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { readClientFixture } from "./support";
import { m } from "../src/lib/messages";

// Same two paths, same reason, as every other spec that talks to Supabase
// from the Playwright runner process directly, not through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Relationships between customers (spec §9). Everything here runs on the PER-RUN fixture account
 * (auth.setup.ts creates it, auth.teardown.ts deletes it unconditionally) — never on `Test Client
 * One` (CLAUDE.md's hard rule): this spec ADDS a relationship, toggles a flag and removes a row,
 * all mutations, and the seeded account is read-only (openAccountByName's own doc comment).
 *
 * The CHILD (the record this spec opens first) is a real contact made with createContact +
 * serviceDb(), stamped and deleted in afterAll. The MOTHER is made through the UI itself — the add
 * dialog's "New person" path — on purpose: that path is the one spec §9 actually ships (a found
 * existing contact is the OTHER path, covered by the add dialog's own component test), and it is
 * also the one the dialog's own "finding 3" fix (relationship-dialog.ts: a failed add after the
 * person exists retries by id, never duplicates them) exists for. There is no id to hold onto until
 * the dialog hands one back, so afterAll finds her only by her own stamped last name, and this
 * file's own two chip-text assertions in test 1 are what prove the add really landed before
 * anything downstream relies on her existing at all.
 *
 * describe.serial on purpose: test 2 edits and removes the exact row test 1 created, and test 3
 * reads that same row again, in Spanish — out of order, either finds nothing to assert against or
 * asserts the wrong thing silently (the same reasoning assign.spec.ts's own header gives).
 */
test.describe.configure({ timeout: 60_000 });

const stamp = Date.now();
const CHILD_LAST = `Child ${stamp}`;
const MOTHER_LAST = `Mother ${stamp}`;

test.describe.serial("relationships on the record", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  let accountId = "";
  let childId = "";

  test.beforeAll(async () => {
    const fixture = readClientFixture();
    test.skip(!fixture, "No client fixture: the setup project creates it; run the full suite.");
    accountId = fixture!.accountId;
    childId = (await createContact(
      serviceDb(), accountId, { firstName: "E2E", lastName: CHILD_LAST }, "e2e-relationships",
    )).id;
  });

  test.afterAll(async () => {
    if (!accountId) return;
    const db = serviceDb();
    // Both of this spec's own contacts, by stamped last name — the mother exists only because the
    // UI created her in test 1, never by an id this file minted itself. contact_relationships
    // (0070) cascades off BOTH contact_id and related_contact_id, so the row the dialog wrote, and
    // anything test 2 did to it, goes with them. Checked, not assumed: a silent failure here would
    // strand a real row on an account auth.teardown.ts is about to delete anyway, but checking is
    // what every other spec that deletes its own fixtures does (assign.spec.ts's own afterAll).
    const { error } = await db.from("contacts").delete()
      .eq("account_id", accountId).in("last_name", [CHILD_LAST, MOTHER_LAST]);
    expect(error, "deleting this spec's own contacts").toBeNull();
  });

  test("an Owner adds a mother as a new person; both records read correctly", async ({ page }) => {
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
    await expect(card.getByText(`Mother: E2E ${MOTHER_LAST}`)).toBeVisible();

    const db = serviceDb();
    const { data: rows } = await db.from("contact_relationships")
      .select("label_key, contact_form, related_form, contact_id, related_contact_id")
      .eq("account_id", accountId).eq("related_contact_id", childId);
    expect(rows).toHaveLength(1);
    // contact_id is the OTHER side ("a") for a parent:a add (relationship-view.ts's
    // newRelationshipFor): the mother, "f" for the Mother radio; related_contact_id is the
    // subject (the child), "m" for the Son radio.
    expect(rows![0]).toMatchObject({ label_key: "parent", contact_form: "f", related_form: "m" });
    // Hand-added (F-085 part 1, spec R4): the Owner's own write assigns the new contact at once,
    // never left Unassigned on a guess.
    const { data: mother } = await db.from("contacts").select("id, assigned_to")
      .eq("id", rows![0]!.contact_id).single();
    expect(mother!.assigned_to).not.toBeNull();

    // The reciprocal: the SAME row, read from the mother's own record, in her own word.
    await card.getByRole("link", { name: `Mother: E2E ${MOTHER_LAST}` }).click();
    await expect(page.locator("[data-relationships-card]").getByText(`Son: E2E ${CHILD_LAST}`)).toBeVisible();
  });

  test("a flag saves at once with Undo; remove has Undo and restores the same row", async ({ page }) => {
    const db = serviceDb();
    const readRow = async () => (await db.from("contact_relationships")
      .select("id, contact_can_pick_up")
      .eq("account_id", accountId).eq("related_contact_id", childId)).data ?? [];
    await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
    const chip = page.locator("[data-relationship-chip]").filter({ hasText: `Mother: E2E ${MOTHER_LAST}` });
    // Positive control: the row test 1 made is really on the page before this test's own writes
    // (the toggle, then the remove) are asked to prove anything about it.
    await expect(chip).toBeVisible();

    await chip.getByRole("button", { name: m["relationships.flag.canPickUp"] }).click();
    await expect(chip.getByRole("button", { name: m["relationships.flag.canPickUp"] }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readRow())[0]?.contact_can_pick_up).toBe(true);
    await page.getByRole("button", { name: m["relationships.undo"] }).click();
    await expect.poll(async () => (await readRow())[0]?.contact_can_pick_up).toBe(false);

    const before = (await readRow())[0]!.id;
    await chip.getByRole("button", { name: m["relationships.remove"].replace("{name}", `E2E ${MOTHER_LAST}`) }).click();
    await expect(page.getByText(m["relationships.removed"].replace("{name}", `E2E ${MOTHER_LAST}`))).toBeVisible();
    await expect.poll(async () => (await readRow()).length).toBe(0);
    await page.getByRole("button", { name: m["relationships.undo"] }).click();
    await expect.poll(async () => (await readRow())[0]?.id).toBe(before);
  });

  test("a Spanish reader sees 'Madre:'", async ({ page }) => {
    const db = serviceDb();
    // Exactly one Owner membership exists on a per-run fixture account: the client fixture user is
    // the ONLY Clerk org:admin on its org (auth.setup.ts's `createdBy: user.id`), and
    // roleFromClerk (@bis/db/team.ts) answers "owner" only for org:admin with no demoting
    // bis_role metadata; Staff's own org:member answers "staff", and Technician is written
    // directly with that role. `.limit(1)` is therefore never hiding a second real Owner.
    const { data: owner } = await db.from("memberships").select("user_id")
      .eq("scope", "account").eq("account_id", accountId).eq("role", "owner").limit(1).single();
    const { data: prior } = await db.from("users").select("language").eq("id", owner!.user_id).single();
    await db.from("users").update({ language: "es" }).eq("id", owner!.user_id);
    try {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
      await expect(page.locator('[data-relationships-card][lang="es"]').getByText(`Madre: E2E ${MOTHER_LAST}`))
        .toBeVisible();
    } finally {
      // Per-person state (users.language), reset for whoever runs next — this is the Owner's own
      // row, not scoped to this run, so leaving it in Spanish would carry into the next run's
      // English-language assertions elsewhere.
      await db.from("users").update({ language: prior!.language }).eq("id", owner!.user_id);
    }
  });
});
