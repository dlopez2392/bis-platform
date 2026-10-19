import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpportunityStagePayload, Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { ApplyCtx, Db, DescribeCtx, EditCtx } from "./types";

const db = vi.hoisted(() => ({ moveOpportunityToStage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { opportunityStageKind } from "./opportunity-stage";

const en = makeTr("en");
const es = makeTr("es");
const NOW = new Date("2026-10-19T15:00:00Z");
const NAMES = { s0: ["New", 0], s1: ["Contacted", 1], s2: ["Quote sent", 2], s3: ["Won", 3] } as const;
const stagesById = Object.fromEntries(Object.entries(NAMES).map(([id, [name, position]]) => [id, { name, position }]));
const dctx = (tr = en, stages: DescribeCtx["stages"] = stagesById): DescribeCtx => ({ tr, zone: "America/Chicago", stages, now: NOW });
const ectx: EditCtx = {
  zone: "America/Chicago", now: NOW, pipelineIdOfDeal: "P",
  stages: [
    { id: "s0", position: 0, pipelineId: "P" }, { id: "s1", position: 1, pipelineId: "P" },
    { id: "s2", position: 2, pipelineId: "P" }, { id: "s3", position: 3, pipelineId: "P" },
    { id: "q1", position: 1, pipelineId: "Q" },
  ],
};
const stored: OpportunityStagePayload = { opportunityId: "o1", fromStageId: "s0", toStageId: "s1" };

/** A request client that answers one `opportunities` read with `deal` and records the query. */
function dealDb(deal: { stage_id: string; status: string } | null, error: { message: string } | null = null) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), chain),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), chain),
    maybeSingle: async () => ({ data: deal, error }),
  };
  const fake = { from: (t: string) => (calls.push(["from", t]), chain) };
  return { db: fake as unknown as Db, calls };
}
const row = (payload = stored) =>
  ({ kind: "opportunity_stage", payload, accountId: "a1", contactId: "c1" } as unknown as Proposal & { kind: "opportunity_stage" });
const ctxWith = (d: Db): ApplyCtx => ({ db: d, accountId: "a1", userId: "user_1", contactId: "c1" });

beforeEach(() => vi.clearAllMocks());

describe("opportunity_stage: parse and describe", () => {
  it("parses its own payload and refuses the other kinds'", () => {
    expect(opportunityStageKind.parse(stored)).toEqual(stored);
    expect(opportunityStageKind.parse({ title: "Call", dueAt: null })).toBeNull();
    expect(opportunityStageKind.parse({ field: "phone", value: "+15551234567" })).toBeNull();
  });

  it("names the move by the account's stage names and says when one stage is skipped", () => {
    const p = { ...stored, toStageId: "s2" };
    expect(opportunityStageKind.describe(p, dctx()))
      .toEqual({ parts: [{ text: "Move from New to Quote sent" }], detail: "A stage is skipped in between.", pastDue: false });
    expect(opportunityStageKind.describe(p, dctx(es)))
      .toEqual({ parts: [{ text: "Mover de New a Quote sent" }], detail: "Se salta una etapa.", pastDue: false });
  });

  it("says how many stages are skipped when it is more than one", () => {
    const five = { b0: { name: "New", position: 0 }, b3: { name: "Booked", position: 3 } };
    const p = { opportunityId: "o1", fromStageId: "b0", toStageId: "b3" };
    expect(opportunityStageKind.describe(p, dctx(en, five)).detail).toBe("2 stages are skipped in between.");
    expect(opportunityStageKind.describe(p, dctx(es, five)).detail).toBe("Se saltan 2 etapas.");
  });

  it("the next stage skips nothing", () => {
    expect(opportunityStageKind.describe(stored, dctx()).detail).toBeNull();
  });

  it("a stage it cannot name is still shown, as a sentence to review, never as an id (deviation 9)", () => {
    const p = { ...stored, toStageId: "gone" };
    expect(opportunityStageKind.describe(p, dctx()))
      .toEqual({ parts: [{ text: "Review the stage change on this deal." }], detail: null, pastDue: false });
    expect(opportunityStageKind.describe(p, dctx(es)).parts)
      .toEqual([{ text: "Revise el cambio de etapa de esta oportunidad." }]);
  });
});

describe("opportunity_stage: an id that names an Object.prototype member", () => {
  it("is not a stage: 'constructor' and 'toString' read as unresolved, in the sentence and the toast", () => {
    // Mutation: look up with stages[id] -> the prototype's function resolves as a stage, FAILS.
    for (const id of ["constructor", "toString", "__proto__"]) {
      expect(opportunityStageKind.describe({ ...stored, toStageId: id }, dctx()).parts, id)
        .toEqual([{ text: "Review the stage change on this deal." }]);
      expect(opportunityStageKind.describe({ ...stored, fromStageId: id }, dctx()).parts, id)
        .toEqual([{ text: "Review the stage change on this deal." }]);
      expect(opportunityStageKind.toast({ ...stored, toStageId: id }, en, stagesById), id).toBe("Accepted");
    }
  });
});

describe("opportunity_stage: validateEdit (forward only, never the last stage, the deal's own pipeline)", () => {
  const bad = { ok: false, error: { field: "toStageId", key: "suggestions.edit.stageInvalid" } };

  it("a later stage that is not the last is accepted", () => {
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "s2" }, ectx))
      .toEqual({ ok: true, payload: { opportunityId: "o1", fromStageId: "s0", toStageId: "s2" } });
  });

  it("refuses the current stage and an earlier one", () => {
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "s0" }, ectx)).toEqual(bad);
    const fromQuote = { ...stored, fromStageId: "s2", toStageId: "s2" };
    expect(opportunityStageKind.validateEdit(fromQuote, { toStageId: "s1" }, ectx)).toEqual(bad);
  });

  it("refuses the last stage", () => {
    // Mutation: drop the last-stage check -> FAILS.
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "s3" }, ectx)).toEqual(bad);
  });

  it("refuses another pipeline's stage, an unknown stage, and a deal whose pipeline is unknown", () => {
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "q1" }, ectx)).toEqual(bad);
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "nope" }, ectx)).toEqual(bad);
    expect(opportunityStageKind.validateEdit(stored, { toStageId: 7 }, ectx)).toEqual(bad);
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "s2" }, { ...ectx, pipelineIdOfDeal: null })).toEqual(bad);
  });

  it("keeps the stored deal and starting stage whatever the form posted (spec probe :352)", () => {
    // Mutation: read opportunityId or fromStageId from the input -> FAILS.
    expect(opportunityStageKind.validateEdit(stored, { toStageId: "s2", opportunityId: "o2", fromStageId: "s1" }, ectx))
      .toEqual({ ok: true, payload: { opportunityId: "o1", fromStageId: "s0", toStageId: "s2" } });
  });
});

describe("opportunity_stage: stillHolds", () => {
  it("reads the deal on the account, and answers gone, closed, moved or ok in that order", async () => {
    const gone = dealDb(null);
    expect(await opportunityStageKind.stillHolds(gone.db, row())).toEqual({ ok: false, reason: "deal_gone" });
    expect(gone.calls).toEqual([
      ["from", "opportunities"], ["select", "stage_id, status"], ["eq", "account_id", "a1"], ["eq", "id", "o1"],
    ]);
    expect(await opportunityStageKind.stillHolds(dealDb({ stage_id: "s1", status: "open" }).db, row()))
      .toEqual({ ok: false, reason: "deal_moved" });
    expect(await opportunityStageKind.stillHolds(dealDb({ stage_id: "s0", status: "open" }).db, row()))
      .toEqual({ ok: true });
  });

  it("a closed deal reads closed, at the suggestion's stage or at another (the status is checked first)", async () => {
    // Mutation: check the stage before the status. The same-stage case cannot catch that (its stage
    // check passes either way); the closed-at-another-stage case then reads deal_moved, FAILS.
    expect(await opportunityStageKind.stillHolds(dealDb({ stage_id: "s0", status: "won" }).db, row()))
      .toEqual({ ok: false, reason: "deal_closed" });
    expect(await opportunityStageKind.stillHolds(dealDb({ stage_id: "s3", status: "won" }).db, row()))
      .toEqual({ ok: false, reason: "deal_closed" });
  });

  it("a read error throws rather than reading as gone", async () => {
    await expect(opportunityStageKind.stillHolds(dealDb(null, { message: "boom" }).db, row())).rejects.toThrow("boom");
  });
});

describe("opportunity_stage: apply and inverse", () => {
  it("moves through moveOpportunityToStage and returns the move", async () => {
    const { db: d } = dealDb(null);
    const p = { ...stored, toStageId: "s2" };
    expect(await opportunityStageKind.apply(ctxWith(d), p)).toEqual({ ref: p });
    expect(db.moveOpportunityToStage).toHaveBeenCalledWith(d, "a1", "o1", "s2", "user_1");
  });

  const undo = (d: Db, ref: unknown) => {
    if (!("undo" in opportunityStageKind.inverse)) throw new Error("irreversible");
    return opportunityStageKind.inverse.undo(ctxWith(d), ref);
  };
  const ref = { opportunityId: "o1", fromStageId: "s0", toStageId: "s2" };

  it("moves back while the deal is still open at the stage the Accept moved it to", async () => {
    const { db: d } = dealDb({ stage_id: "s2", status: "open" });
    expect(await undo(d, ref)).toBe("undone");
    expect(db.moveOpportunityToStage).toHaveBeenCalledWith(d, "a1", "o1", "s0", "user_1");
  });

  it("a deal moved, closed or gone since is left alone", async () => {
    expect(await undo(dealDb({ stage_id: "s1", status: "open" }).db, ref)).toBe("changed");
    expect(await undo(dealDb({ stage_id: "s2", status: "lost" }).db, ref)).toBe("changed");
    expect(await undo(dealDb(null).db, ref)).toBe("changed");
    expect(await undo(dealDb(null).db, null)).toBe("changed");
    expect(db.moveOpportunityToStage).not.toHaveBeenCalled();
  });
});

describe("opportunity_stage: toast and target", () => {
  it("targets the deal and names the stage in the account's own words", () => {
    const p = { ...stored, toStageId: "s2" };
    expect(opportunityStageKind.targetKey(p, "c1")).toBe("deal:o1");
    expect(opportunityStageKind.toast(p, en, stagesById)).toBe("Moved to Quote sent");
    expect(opportunityStageKind.toast(p, es, stagesById)).toBe("Movido a Quote sent");
  });
});
