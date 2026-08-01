import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
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
});
