import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listCustomFields, createCustomField, listCustomValues, upsertCustomValue,
         ensureDefaultPipeline, listPipelinesWithStages } from "../crm-config";

describe("crm config", () => {
  it("custom fields create + list, key validation", () =>
    withTestAccount(async (db, accountId) => {
      await createCustomField(db, accountId,
        { model: "contact", fieldKey: "referral_source", name: "Referral Source",
          dataType: "single_select", options: ["google", "friend"] });
      const defs = await listCustomFields(db, accountId, "contact");
      expect(defs).toHaveLength(1);
      expect(defs[0]!.options).toEqual(["google", "friend"]);
      await expect(createCustomField(db, accountId,
        { model: "contact", fieldKey: "Bad Key!", name: "x", dataType: "text" })).rejects.toThrow();
    }));

  it("custom values upsert overwrites", () =>
    withTestAccount(async (db, accountId) => {
      await upsertCustomValue(db, accountId, { valueKey: "business_name", name: "Business Name", value: "A" });
      await upsertCustomValue(db, accountId, { valueKey: "business_name", name: "Business Name", value: "B" });
      const vals = await listCustomValues(db, accountId);
      expect(vals).toHaveLength(1);
      expect(vals[0]!.value).toBe("B");
    }));

  it("ensureDefaultPipeline is idempotent and seeds 5 stages", () =>
    withTestAccount(async (db, accountId) => {
      const p1 = await ensureDefaultPipeline(db, accountId);
      const p2 = await ensureDefaultPipeline(db, accountId);
      expect(p2.pipelineId).toBe(p1.pipelineId);
      const pipelines = await listPipelinesWithStages(db, accountId);
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]!.stages.map(s => s.name)).toEqual(
        ["New Lead", "Contacted", "Appointment", "Quote Sent", "Closed"]);
    }));
});
