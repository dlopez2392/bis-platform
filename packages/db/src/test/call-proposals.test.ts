import { describe, it, expect } from "vitest";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import {
  insertProposal, listProposalsForCall, listPendingProposals,
  getProposal, markProposalDecided,
} from "../call-proposals";

async function seedCall(db: any, accountId: string): Promise<string> {
  const num = await db.from("phone_numbers")
    .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
  expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();
  const call = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: num.data!.id, caller_e164: "+19562921696" })
    .select("id").single();
  expect(call.error, `calls insert failed: ${call.error?.message}`).toBeNull();
  return call.data!.id as string;
}

describe("call proposals accessors", () => {
  it("round-trips a task proposal", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const created = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(created).not.toBeNull();
      const rows = await listProposalsForCall(db, accountId, callId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe("task");
      expect(rows[0]!.status).toBe("pending");
      expect(rows[0]!.evidence).toBe("call me Tuesday");
    });
  });

  it("refuses a SECOND pending proposal of the same kind on the same call, INCLUDING when contact_id is null (mutation: drop the coalesce from the unique index -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const first = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(first).not.toBeNull();
      const second = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday again", dueAt: null },
      });
      // Swallowed as null, not thrown: a duplicate is a non-event for a
      // best-effort pass, never a reason to fail a call's finish.
      expect(second).toBeNull();
      expect(await listProposalsForCall(db, accountId, callId)).toHaveLength(1);
    });
  });

  it("allows a new pending proposal once the previous one is decided", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const first = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(await markProposalDecided(db, accountId, first!.id, "dismissed", "user_x")).toBe(true);
      const second = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Wednesday",
        payload: { title: "Call back Wednesday", dueAt: null },
      });
      expect(second).not.toBeNull();
    });
  });

  it("rejects an empty evidence string (mutation: drop call_proposals_evidence_nonempty -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const created = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "   ",
        payload: { title: "Ungrounded", dueAt: null },
      });
      expect(created).toBeNull();
    });
  });

  it("markProposalDecided stamps status, decided_at and decided_by, and returns false for an unknown id", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(await markProposalDecided(db, accountId, p!.id, "accepted", "user_abc")).toBe(true);
      const after = await getProposal(db, accountId, p!.id);
      expect(after!.status).toBe("accepted");
      expect(after!.decidedBy).toBe("user_abc");
      expect(after!.decidedAt).not.toBeNull();
      expect(await listPendingProposals(db, accountId)).toHaveLength(0);
      expect(
        await markProposalDecided(db, accountId, "00000000-0000-0000-0000-000000000001", "accepted", "user_abc"),
      ).toBe(false);
    });
  });

  it("markProposalDecided will not decide a proposal belonging to another account", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      const wrong = "00000000-0000-0000-0000-0000000000aa";
      expect(await markProposalDecided(db, wrong, p!.id, "accepted", "user_abc")).toBe(false);
      expect((await getProposal(db, accountId, p!.id))!.status).toBe("pending");
    });
  });
});
