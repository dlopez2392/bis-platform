import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact, addTagToContact } from "../contacts";
import { createCustomField, upsertCustomValue, ensureDefaultPipeline } from "../crm-config";
import { createForm, updateForm } from "../forms";
import { captureBlueprint, listBlueprints, getBlueprint } from "../blueprints";

async function seedConfig(db: any, accountId: string) {
  await ensureDefaultPipeline(db, accountId);
  await createCustomField(db, accountId, {
    model: "contact", fieldKey: "proj_type", name: "Project type",
    dataType: "single_select", options: ["Deck", "Fence"],
  });
  await upsertCustomValue(db, accountId, { valueKey: "business_name", name: "Business name", value: "Acme Decks" });
  const { id: formId } = await createForm(db, accountId, {
    name: "Quote Request",
    fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
  }, "user_test");
  await updateForm(db, accountId, formId, {
    status: "published", notify_emails: ["owner@acme.example"],
  }, "user_test");
  return { formId };
}

describe("blueprint capture", () => {
  it("captures configuration and excludes live data and tenant-specific values", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      await createContact(db, accountId, { firstName: "Maria", email: "maria@example.com" }, "user_test");

      const { id } = await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");
      const bp = await getBlueprint(db, id);

      expect(bp!.version).toBe(1);
      expect(bp!.assets.schemaVersion).toBe(1);
      expect(bp!.assets.pipelines.length).toBeGreaterThan(0);
      expect(bp!.assets.pipelines[0]!.stages.length).toBeGreaterThan(0);
      expect(bp!.assets.customFields[0]!.fieldKey).toBe("proj_type");
      expect(bp!.assets.forms[0]!.name).toBe("Quote Request");

      // The exclusions are the load-bearing part of this feature.
      const serialized = JSON.stringify(bp!.assets);
      expect(serialized).not.toContain("maria@example.com");   // no live data
      expect(serialized).not.toContain("owner@acme.example");  // no notify address
      expect(serialized).not.toContain("Acme Decks");          // custom value blanked
      expect(bp!.assets.customValues[0]!.valueKey).toBe("business_name");
      expect(bp!.assets.forms[0]).not.toHaveProperty("publicId");
      expect(bp!.assets.forms[0]).not.toHaveProperty("notifyEmails");
    }));

  it("recapturing the same name replaces the bundle and bumps version", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      const first = await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");

      await createCustomField(db, accountId, {
        model: "contact", fieldKey: "roof_age", name: "Roof age", dataType: "number",
      });
      const second = await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");

      expect(second.id).toBe(first.id);
      const bp = await getBlueprint(db, second.id);
      expect(bp!.version).toBe(2);
      expect(bp!.assets.customFields.map((f) => f.fieldKey).sort()).toEqual(["proj_type", "roof_age"]);

      expect(await listBlueprints(db)).toHaveLength(1);
    }));

  it("capture emits an event against the source account", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      await captureBlueprint(db, accountId, { name: "Contractor Starter" }, "user_test");

      const { data } = await db.from("events").select("type, actor_type")
        .eq("account_id", accountId).eq("type", "blueprint.captured");
      expect(data).toHaveLength(1);
      expect(data![0]!.actor_type).toBe("user");
    }));

  it("gives distinct keys to two names that slug to the same string", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(
        db, accountId, { firstName: "Case", email: "case-collision@example.com" }, "user_test");
      // "Hot Lead" -> "hot lead" and "hot-lead" are two distinct, legal tag
      // names (tags has unique(account_id, name), and both pass it) that both
      // slug to "hot_lead" — the exact collision blueprintKey's old docstring
      // claimed was unreachable.
      await addTagToContact(db, accountId, contactId, "Hot Lead");
      await addTagToContact(db, accountId, contactId, "hot-lead");

      const { id } = await captureBlueprint(db, accountId, { name: "Collision Case" }, "user_test");
      const bp = await getBlueprint(db, id);

      const tagKeys = bp!.assets.tags.map((t) => t.key).sort();
      expect(tagKeys).toEqual(["tag:hot_lead", "tag:hot_lead_2"]);
      // Distinct keys, not a merge: both source names must still be present.
      expect(bp!.assets.tags.map((t) => t.name).sort()).toEqual(["hot lead", "hot-lead"]);
    }));

  it("gives distinct keys when a third name's natural slug matches a suffixed collision", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(
        db, accountId, { firstName: "Case", email: "case-collision-3way@example.com" }, "user_test");
      // "Hot Lead" and "hot-lead" both slug to "tag:hot_lead" (same collision
      // as above), but "Hot Lead 2" is a third, unrelated tag whose OWN
      // natural slug is "tag:hot_lead_2" — exactly the string a per-base
      // counter would hand to whichever of the first two is processed
      // second. A correct keyer must notice that key is already taken (by
      // "Hot Lead 2" itself, or by the collision pair, depending on
      // processing order) and keep incrementing past it so all three stay
      // distinct.
      await addTagToContact(db, accountId, contactId, "Hot Lead");
      await addTagToContact(db, accountId, contactId, "hot-lead");
      await addTagToContact(db, accountId, contactId, "Hot Lead 2");

      const { id } = await captureBlueprint(db, accountId, { name: "Collision Case 3-Way" }, "user_test");
      const bp = await getBlueprint(db, id);

      const tagKeys = bp!.assets.tags.map((t) => t.key);
      expect(new Set(tagKeys).size).toBe(3);
      // Distinct keys, not a merge: all three source names must still be present.
      expect(bp!.assets.tags.map((t) => t.name).sort()).toEqual(["hot lead", "hot lead 2", "hot-lead"]);
    }));

  it("recapturing an unchanged account produces identical keys both times", () =>
    withTestAccount(async (db, accountId) => {
      await seedConfig(db, accountId);
      const { id: contactId } = await createContact(
        db, accountId, { firstName: "Case", email: "case-determinism@example.com" }, "user_test");
      await addTagToContact(db, accountId, contactId, "Hot Lead");
      await addTagToContact(db, accountId, contactId, "hot-lead");

      // Two independent captures of the same, unchanged account. Nothing is
      // created or modified in between, so buildBundle's queries re-read the
      // exact same rows both times — the id tiebreaker on every ordering is
      // what makes the resulting key sequence (including the "_2" collision
      // suffix above) come out byte-identical rather than depending on
      // whatever order Postgres happens to return equal-position rows in.
      const first = await captureBlueprint(db, accountId, { name: "Determinism A" }, "user_test");
      const firstBp = await getBlueprint(db, first.id);
      const second = await captureBlueprint(db, accountId, { name: "Determinism B" }, "user_test");
      const secondBp = await getBlueprint(db, second.id);

      expect(secondBp!.assets).toEqual(firstBp!.assets);
    }));

  it("buildBundle fails loud, naming the query, instead of persisting an incomplete bundle", async () => {
    // An invalid account id makes every one of buildBundle's six queries
    // error at the database (invalid uuid input) rather than match zero
    // rows — a real, unmocked query failure. Before the fix this fell
    // through `?? []` on all six and captureBlueprint would have happily
    // saved an empty bundle under this name. No account fixture needed:
    // "not-a-uuid" never reaches a real account row.
    const db = serviceDb();
    await expect(
      captureBlueprint(db, "not-a-uuid", { name: "Should Never Save" }, "user_test"),
    ).rejects.toThrow(/pipelines query failed/);

    const { data } = await db.from("blueprints").select("id").eq("name", "Should Never Save");
    expect(data).toHaveLength(0);
  });
});
