import { describe, expect, it, vi } from "vitest";
import {
  PROPOSAL_KINDS, parseContactFieldPayload, parseOpportunityStagePayload, parseTaskPayload,
} from "@bis/db/proposal-rules";

// A bare, empty factory: any kind module that reads a @bis/db value at import time (`apply: addTask`)
// throws `[vitest] No "addTask" export is defined on the "@bis/db" mock` while ./index loads.
vi.mock("@bis/db", () => ({}));

const SAMPLES = {
  task: { title: "Send the quote", dueAt: null },
  contact_field: { field: "phone", value: "+15551234567" },
  opportunity_stage: { opportunityId: "o1", fromStageId: "s1", toStageId: "s2" },
} as const;

describe("the kind registry", () => {
  it("loads with @bis/db mocked empty: no kind reads a @bis/db value at import time", async () => {
    // Mutation: `apply: addTask` in one kind -> the import throws, FAILS.
    await expect(import("./index")).resolves.toHaveProperty("KINDS");
  });

  it("has exactly the kinds PROPOSAL_KINDS lists (the third side of the CHECK parity)", async () => {
    // Mutation: delete opportunity_stage from KINDS -> typecheck fails, and this FAILS.
    const { KINDS } = await import("./index");
    expect(Object.keys(KINDS).sort()).toEqual([...PROPOSAL_KINDS].sort());
    for (const k of PROPOSAL_KINDS) expect(KINDS[k].kind).toBe(k);
  });

  it("every kind comes from a call, carries facts, and can be undone", async () => {
    const { KINDS } = await import("./index");
    for (const k of PROPOSAL_KINDS) {
      expect(KINDS[k].sources).toEqual(["call"]);
      expect(KINDS[k].dataClass).toBe("facts");
      expect("undo" in KINDS[k].inverse).toBe(true);
    }
  });

  it("needs a customer for a field or a deal, not for a to-do", async () => {
    const { KINDS } = await import("./index");
    expect([KINDS.task.needsContact, KINDS.contact_field.needsContact, KINDS.opportunity_stage.needsContact])
      .toEqual([false, true, true]);
  });

  // The read boundary is @bis/db's toProposal, parsing by kind with these three (final review M-1: a kind's
  // own parse was never called on the read path, so it is gone from KindDef).
  it("each kind's read-boundary parser takes its own sample and refuses the other two kinds' (spec 8.1)", async () => {
    const { KINDS, kindOf } = await import("./index");
    const PARSE = { task: parseTaskPayload, contact_field: parseContactFieldPayload, opportunity_stage: parseOpportunityStagePayload };
    for (const k of PROPOSAL_KINDS) {
      for (const other of PROPOSAL_KINDS) {
        const parsed = PARSE[k](SAMPLES[other]);
        if (other === k) expect(parsed).toEqual(SAMPLES[k]);
        else expect(parsed, `${k} parsed a ${other} payload`).toBeNull();
      }
      expect(kindOf(k)).toBe(KINDS[k]);
      expect("parse" in KINDS[k], `${k} carries a parse no reader calls`).toBe(false);
    }
  });
});
