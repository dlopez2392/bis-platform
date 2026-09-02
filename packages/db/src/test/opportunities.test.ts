import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createAccount } from "../accounts";
import { createContact } from "../contacts";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, moveOpportunityStage, moveOpportunityToStage,
         updateOpportunity, setOpportunityStatus,
         listBoard, listContactOpportunities,
         listOpportunityValuesCreatedBetween } from "../opportunities";

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

  it("rejects creating an opportunity for a contact from a different account", () =>
    withTestAccount(async (db, accountId) => {
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);

      // A second, unrelated account with its own contact — the realistic
      // attack shape: a contact id that is real but belongs to someone else.
      const { id: otherAccountId } = await createAccount(db, {
        clerkOrgId: `org_test_${Math.random().toString(36).slice(2, 10)}`,
        name: "Other Co",
        actorId: "user_test",
      });
      try {
        const { id: foreignContactId } = await createContact(
          db, otherAccountId, { firstName: "Foreign" }, "user_test",
        );

        await expect(
          createOpportunity(db, accountId,
            { contactId: foreignContactId, pipelineId, name: "Cross-account", value: 100 },
            "user_test"),
        ).rejects.toThrow("contact not in account");

        const { data: opps } = await db.from("opportunities")
          .select("id").eq("account_id", accountId);
        expect(opps).toHaveLength(0);
      } finally {
        // FK order matters: accounts.id is referenced by events (and would
        // be by contacts) with no ON DELETE CASCADE — deleting the account
        // first leaves it dangling instead of erroring, since the JS client
        // doesn't throw on a failed delete unless the error is checked.
        await db.from("events").delete().eq("account_id", otherAccountId);
        await db.from("contacts").delete().eq("account_id", otherAccountId);
        const { error: delErr } = await db.from("accounts").delete().eq("id", otherAccountId);
        if (delErr) throw new Error(`cleanup failed: ${delErr.message}`);
      }
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

describe("listOpportunityValuesCreatedBetween", () => {
  it("[from, to) on created_at — pins both boundary edges, any status, cross-tenant rows excluded", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (db2, accountB) => {
        const { id: contactA } = await createContact(db, accountA, { firstName: "A" }, "user_test");
        const { id: contactB } = await createContact(db2, accountB, { firstName: "B" }, "user_test");
        const { pipelineId: pipeA } = await ensureDefaultPipeline(db, accountA);
        const { pipelineId: pipeB } = await ensureDefaultPipeline(db2, accountB);

        const from = "2027-06-01T00:00:00.000Z";
        const to = "2027-06-15T00:00:00.000Z";

        async function oppAt(
          dbc: SupabaseClient, acct: string, pipelineId: string, contactId: string,
          value: number, createdIso: string,
        ) {
          const { id } = await createOpportunity(dbc, acct,
            { contactId, pipelineId, name: `opp-${value}`, value }, "user_test");
          const { error } = await dbc.from("opportunities").update({ created_at: createdIso }).eq("id", id);
          if (error) throw new Error(error.message);
          return id;
        }

        // Outside the window on both sides — excluded.
        await oppAt(db, accountA, pipeA, contactA, 111, "2027-05-31T23:59:59.999Z");
        await oppAt(db, accountA, pipeA, contactA, 222, to); // exclusive edge — excluded

        // Inside, including the inclusive `from` edge. One is later marked
        // "won" — pipeline-added value is the created value, not the
        // surviving value, so a status change must not erase the capture.
        await oppAt(db, accountA, pipeA, contactA, 500, from);
        const won = await oppAt(db, accountA, pipeA, contactA, 750, "2027-06-10T12:00:00.000Z");
        await setOpportunityStatus(db, accountA, won, "won", "user_test");
        await oppAt(db, accountA, pipeA, contactA, 900, "2027-06-14T23:59:59.999Z");

        // Same window, other tenant — must not leak into accountA's result.
        await oppAt(db2, accountB, pipeB, contactB, 1000, "2027-06-05T00:00:00.000Z");

        const result = await listOpportunityValuesCreatedBetween(db, accountA, from, to);
        expect(result).toHaveLength(3);
        expect(result.map((r) => r.monetaryValue)).toEqual([500, 750, 900]);
        expect(result.map((r) => new Date(r.createdAt).getTime())).toEqual([
          new Date(from).getTime(),
          new Date("2027-06-10T12:00:00.000Z").getTime(),
          new Date("2027-06-14T23:59:59.999Z").getTime(),
        ]);
      });
    });
  });
});
