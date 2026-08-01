import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact, addTagToContact } from "../contacts";
import { createCustomField, upsertCustomValue, ensureDefaultPipeline } from "../crm-config";
import { createForm, updateForm } from "../forms";
import { captureBlueprint, listBlueprints, getBlueprint, applyBlueprint } from "../blueprints";

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

describe("blueprint apply", () => {
  it("applies configuration, and applying twice creates nothing twice", () =>
    withTestAccount(async (db, sourceId) => {
      await seedConfig(db, sourceId);
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        const first = await applyBlueprint(db2, targetId, blueprintId, "user_test");
        expect(first.failed).toHaveLength(0);
        expect(first.created.length).toBeGreaterThan(0);

        const countAll = async () => {
          const t = async (table: string) => {
            const { data } = await db2.from(table).select("id").eq("account_id", targetId);
            return data?.length ?? 0;
          };
          return {
            pipelines: await t("pipelines"), stages: await t("pipeline_stages"),
            fields: await t("custom_fields"), values: await t("custom_values"),
            forms: await t("forms"),
          };
        };
        const afterFirst = await countAll();
        expect(afterFirst.pipelines).toBeGreaterThan(0);
        expect(afterFirst.forms).toBe(1);

        // The whole point of the partial unique index.
        const second = await applyBlueprint(db2, targetId, blueprintId, "user_test");
        expect(second.created).toHaveLength(0);
        expect(second.skipped.length).toBeGreaterThan(0);
        expect(await countAll()).toEqual(afterFirst);
      });
    }));

  it("an applied form is a draft with its own public id and no notify address", () =>
    withTestAccount(async (db, sourceId) => {
      const { formId } = await seedConfig(db, sourceId);
      const { data: source } = await db.from("forms").select("public_id").eq("id", formId).single();
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        await applyBlueprint(db2, targetId, blueprintId, "user_test");
        const { data: applied } = await db2.from("forms")
          .select("public_id, notify_emails, status, origin, blueprint_key")
          .eq("account_id", targetId).single();

        // Sharing a token would collide on the global unique index — and if it
        // somehow did not, one client's URL would serve another's form.
        expect(applied!.public_id).not.toBe(source!.public_id);
        expect(applied!.notify_emails).toEqual([]);
        // Never publish a public URL because someone picked from a dropdown.
        expect(applied!.status).toBe("draft");
        expect(applied!.origin).toBe("blueprint");
        expect(applied!.blueprint_key).toBeTruthy();
      });
    }));

  it("applied custom values keep their key and name but not the source value", () =>
    withTestAccount(async (db, sourceId) => {
      await seedConfig(db, sourceId);
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        await applyBlueprint(db2, targetId, blueprintId, "user_test");
        const { data } = await db2.from("custom_values")
          .select("value_key, name, value").eq("account_id", targetId).single();
        expect(data!.value_key).toBe("business_name");
        expect(data!.name).toBe("Business name");
        expect(data!.value).toBe("");
      });
    }));

  it("clones no live data and emits blueprint.applied on the target", () =>
    withTestAccount(async (db, sourceId) => {
      await seedConfig(db, sourceId);
      await createContact(db, sourceId, { firstName: "Maria", email: "maria@example.com" }, "user_test");
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        await applyBlueprint(db2, targetId, blueprintId, "user_test");

        const { data: contacts } = await db2.from("contacts").select("id").eq("account_id", targetId);
        expect(contacts).toHaveLength(0);

        const { data: ev } = await db2.from("events").select("payload, actor_type")
          .eq("account_id", targetId).eq("type", "blueprint.applied");
        expect(ev).toHaveLength(1);
        expect((ev![0]!.payload as any).blueprintId).toBe(blueprintId);
        expect((ev![0]!.payload as any).version).toBe(1);
      });
    }));

  it("a form referencing a custom field resolves because fields apply first", () =>
    withTestAccount(async (db, sourceId) => {
      await ensureDefaultPipeline(db, sourceId);
      await createCustomField(db, sourceId, {
        model: "contact", fieldKey: "proj_type", name: "Project type", dataType: "text",
      });
      await createForm(db, sourceId, {
        name: "Quote", fields: [
          { key: "custom_proj_type", kind: "custom.proj_type", label: "Project type", required: false },
        ],
      }, "user_test");
      const { id: blueprintId } = await captureBlueprint(db, sourceId, { name: "Starter" }, "user_test");

      await withTestAccount(async (db2, targetId) => {
        const report = await applyBlueprint(db2, targetId, blueprintId, "user_test");
        expect(report.failed).toHaveLength(0);

        const { data: field } = await db2.from("custom_fields")
          .select("field_key").eq("account_id", targetId).single();
        const { data: form } = await db2.from("forms")
          .select("fields").eq("account_id", targetId).single();
        expect(field!.field_key).toBe("proj_type");
        expect((form!.fields as any[])[0].kind).toBe("custom.proj_type");
      });
    }));

  it("reports a missing blueprint instead of throwing", () =>
    withTestAccount(async (db, accountId) => {
      await expect(
        applyBlueprint(db, accountId, "00000000-0000-0000-0000-000000000000", "user_test"),
      ).rejects.toThrow(/not found/i);
    }));
});
