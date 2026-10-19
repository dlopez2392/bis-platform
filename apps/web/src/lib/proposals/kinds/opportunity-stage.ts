import { moveOpportunityToStage } from "@bis/db";
import { parseOpportunityStagePayload, type OpportunityStagePayload } from "@bis/db/proposal-rules";
import type { Db, DescribeCtx, KindDef } from "./types";

/** The deal as the move reads it. A read error throws: it is not the deal being gone. */
async function readDeal(db: Db, accountId: string, opportunityId: string) {
  const { data, error } = await db.from("opportunities")
    .select("stage_id, status").eq("account_id", accountId).eq("id", opportunityId).maybeSingle();
  if (error) throw new Error(`opportunity_stage: deal read failed: ${error.message}`);
  return data as { stage_id: string; status: string } | null;
}

/** Own keys only: a stage id of "constructor" or "toString" must not resolve to Object.prototype's. */
function stageOf(stages: DescribeCtx["stages"], id: string) {
  return Object.hasOwn(stages, id) ? stages[id] : undefined;
}

function readRef(ref: unknown): OpportunityStagePayload | null {
  return parseOpportunityStagePayload(ref);
}

export const opportunityStageKind: KindDef<"opportunity_stage", OpportunityStagePayload> = {
  kind: "opportunity_stage",
  sources: ["call"],
  needsContact: true,
  dataClass: "facts",

  describe(p, { tr, stages }) {
    const from = stageOf(stages, p.fromStageId);
    const to = stageOf(stages, p.toStageId);
    // Shown, never hidden and never as an id (plan deviation 9): Accept still reads the deal itself.
    if (!from || !to) return { parts: [{ text: tr.text("suggestions.stage.unresolved") }], detail: null, pastDue: false };
    // No stage is skipped silently: the stages the move passes over, in either direction.
    const skipped = Math.abs(to.position - from.position) - 1;
    return {
      parts: [{ text: tr.text("suggestions.stage", { from: from.name, to: to.name }) }],
      detail: skipped > 0 ? tr.count("suggestions.stage.skipped", skipped) : null,
      pastDue: false,
    };
  },

  editable: ["toStageId"],

  validateEdit(stored, input, { stages, pipelineIdOfDeal }) {
    const refused = { ok: false as const, error: { field: "toStageId", key: "suggestions.edit.stageInvalid" as const } };
    const toStageId = input.toStageId;
    if (typeof toStageId !== "string" || pipelineIdOfDeal === null) return refused;
    // The deal's own pipeline only; forward only (P7); never the last stage, which is where a deal is
    // closed (generate.ts: checked by position, never by a seeded name).
    const own = stages.filter((s) => s.pipelineId === pipelineIdOfDeal);
    const target = own.find((s) => s.id === toStageId);
    const from = own.find((s) => s.id === stored.fromStageId);
    if (!target || !from || target.position <= from.position) return refused;
    if (target.position === Math.max(...own.map((s) => s.position))) return refused;
    return { ok: true, payload: { opportunityId: stored.opportunityId, fromStageId: stored.fromStageId, toStageId } };
  },

  normalise: (p) => ({ opportunityId: p.opportunityId, fromStageId: p.fromStageId, toStageId: p.toStageId }),

  async stillHolds(db, row) {
    const deal = await readDeal(db, row.accountId, row.payload.opportunityId);
    if (!deal) return { ok: false, reason: "deal_gone" };
    // The status first: a deal closed at the very stage the suggestion named has not moved.
    if (deal.status !== "open") return { ok: false, reason: "deal_closed" };
    if (deal.stage_id !== row.payload.fromStageId) return { ok: false, reason: "deal_moved" };
    return { ok: true };
  },

  async apply({ db, accountId, userId }, p) {
    await moveOpportunityToStage(db, accountId, p.opportunityId, p.toStageId, userId);
    return { ref: { opportunityId: p.opportunityId, fromStageId: p.fromStageId, toStageId: p.toStageId } };
  },

  inverse: {
    async undo({ db, accountId, userId }, ref) {
      const r = readRef(ref);
      if (!r) return "changed";
      const deal = await readDeal(db, accountId, r.opportunityId);
      if (!deal || deal.status !== "open" || deal.stage_id !== r.toStageId) return "changed";
      await moveOpportunityToStage(db, accountId, r.opportunityId, r.fromStageId, userId);
      return "undone";
    },
  },

  toast(p, tr, stages) {
    const to = stageOf(stages, p.toStageId);
    return to ? tr.text("suggestions.toast.stage", { stage: to.name }) : tr.text("suggestions.status.accepted");
  },
  targetKey: (p) => `deal:${p.opportunityId}`,
};
