import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, moveOpportunityStage, setOpportunityStatus,
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
});
