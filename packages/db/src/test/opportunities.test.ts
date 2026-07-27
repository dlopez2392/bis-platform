import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, moveOpportunityStage, moveOpportunityToStage,
         updateOpportunity, setOpportunityStatus,
         listBoard, listContactOpportunities } from "../opportunities";

describe("opportunities", () => {
  it("create → first stage; move right; board groups + totals", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Opp" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id } = await createOpportunity(db, accountId,
        { contactId, pipelineId, name: "Deck build", value: 4500 }, "user_test");
      let board = await listBoard(db, accountId, pipelineId);
      expect(board[0]!.stage.name).toBe("New Lead");
      expect(board[0]!.opportunities).toHaveLength(1);
      expect(board[0]!.totalValue).toBe(4500);
      await moveOpportunityStage(db, accountId, id, "right", "user_test");
      board = await listBoard(db, accountId, pipelineId);
      expect(board[0]!.opportunities).toHaveLength(0);
      expect(board[1]!.opportunities).toHaveLength(1);
      await moveOpportunityStage(db, accountId, id, "left", "user_test");
      await moveOpportunityStage(db, accountId, id, "left", "user_test"); // no-op at left end
      board = await listBoard(db, accountId, pipelineId);
      expect(board[0]!.opportunities).toHaveLength(1);
    }));

  it("status change emits event; contact opportunity list", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "W" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id } = await createOpportunity(db, accountId,
        { contactId, pipelineId, name: "Fence", value: 1200 }, "user_test");
      await setOpportunityStatus(db, accountId, id, "won", "user_test");
      const opps = await listContactOpportunities(db, accountId, contactId);
      expect(opps[0]!.status).toBe("won");
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .in("type", ["opportunity.created", "opportunity.status_changed"]);
      expect(ev).toHaveLength(2);
    }));

  it("moves an opportunity to an explicit stage", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Move" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id } = await createOpportunity(db, accountId,
        { contactId, pipelineId, name: "Deal", value: 100 }, "user_test");
      const board = await listBoard(db, accountId, pipelineId);
      const targetStageId = board[2]!.stage.id;

      await moveOpportunityToStage(db, accountId, id, targetStageId, "user_test");

      const after = await listBoard(db, accountId, pipelineId);
      expect(after[2]!.opportunities).toHaveLength(1);
      expect(after[2]!.opportunities[0]!.id).toBe(id);
      expect(after[0]!.opportunities).toHaveLength(0);
    }));

  it("updates name, value, and status together", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Update" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id } = await createOpportunity(db, accountId,
        { contactId, pipelineId, name: "Old", value: 100 }, "user_test");

      await updateOpportunity(
        db, accountId, id, { name: "New", value: 250, status: "won" }, "user_test",
      );

      const { data } = await db.from("opportunities")
        .select("name, monetary_value, status").eq("id", id).single();
      expect(data!.name).toBe("New");
      expect(Number(data!.monetary_value)).toBe(250);
      expect(data!.status).toBe("won");
    }));

  it("rejects moving to a stage from a different pipeline and leaves stage_id unchanged", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Guard" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id } = await createOpportunity(db, accountId,
        { contactId, pipelineId, name: "Protected", value: 300 }, "user_test");

      const { data: before } = await db.from("opportunities")
        .select("stage_id").eq("id", id).single();

      // A second pipeline in the same account — the realistic attack shape: a stage id
      // that is valid in the account but does not belong to this opportunity's pipeline.
      const { data: otherPipeline, error: pErr } = await db.from("pipelines")
        .insert({ account_id: accountId, name: "Other Pipeline" }).select("id").single();
      if (pErr || !otherPipeline) throw new Error(`other pipeline create failed: ${pErr?.message}`);
      const { data: foreignStage, error: sErr } = await db.from("pipeline_stages")
        .insert({ account_id: accountId, pipeline_id: otherPipeline.id, name: "Foreign Stage", position: 0 })
        .select("id").single();
      if (sErr || !foreignStage) throw new Error(`foreign stage create failed: ${sErr?.message}`);

      await expect(
        moveOpportunityToStage(db, accountId, id, foreignStage.id, "user_test"),
      ).rejects.toThrow("stage not in pipeline");

      const { data: after } = await db.from("opportunities")
        .select("stage_id").eq("id", id).single();
      expect(after!.stage_id).toBe(before!.stage_id);
    }));

  it("updateOpportunity with no fields is a no-op: no write, no event", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "NoOp" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id } = await createOpportunity(db, accountId,
        { contactId, pipelineId, name: "Untouched", value: 50 }, "user_test");

      await updateOpportunity(db, accountId, id, {}, "user_test");

      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .eq("type", "opportunity.updated");
      expect(ev).toHaveLength(0);
    }));
});
