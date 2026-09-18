// `withTestAccount` yields `serviceDb()`, which bypasses RLS and every
// grant — nothing in this file touches either. The RLS/grants boundary
// (a client sees its own proposal, the agency sees every account's, a
// different client sees zero rows, the column-scoped UPDATE grant, the
// withheld DELETE grant) is proved instead in
// `call-proposals-grants.test.ts`, which runs as `authenticated` via
// `withRollback` + `actAs`.
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import {
  insertProposal, listProposalsForCall, listPendingProposals,
  getProposal, markProposalDecided,
} from "../call-proposals";
import type { ProposalInput } from "../call-proposals";

async function seedCall(db: SupabaseClient, accountId: string): Promise<string> {
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

  // Important 1. Proved live: removing `.eq("status", "pending")` from
  // `markProposalDecided` (call-proposals.ts:120) leaves this failing on
  // BOTH halves —
  //   expect(second).toBe(false)      // Expected: false, Received: true
  //   expect(after!.decidedBy).toBe("user_first")   // Received: "user_second"
  // — because a second decide then simply overwrites the row instead of
  // matching zero.
  it("a second decide by a DIFFERENT user is refused, and decidedBy stays the FIRST user's (mutation: drop .eq(\"status\", \"pending\") from markProposalDecided -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(await markProposalDecided(db, accountId, p!.id, "accepted", "user_first")).toBe(true);
      const second = await markProposalDecided(db, accountId, p!.id, "dismissed", "user_second");
      expect(second).toBe(false);
      const after = await getProposal(db, accountId, p!.id);
      expect(after!.decidedBy).toBe("user_first");
      expect(after!.status).toBe("accepted");
    });
  });

  // Important 2. The account filter is the only tenant barrier on reads —
  // there is no composite FK tying call_proposals to calls/accounts, so
  // nothing at the database level stops a query filtered only by call_id or
  // id from crossing accounts. Proved live: stripping
  // `.eq("account_id", accountId)` from all three read accessors
  // (call-proposals.ts:77, 87, 100) simultaneously leaves this failing on
  // every assertion —
  //   expect(pendingA.map((p) => p.id)).toEqual([propA!.id])
  //     Received: [propA.id, propB.id]  (order not guaranteed either)
  //   expect(await listProposalsForCall(dbA, accountA, callB)).toEqual([])
  //     Received: [ <account B's proposal> ]
  //   expect(await getProposal(dbA, accountA, propB!.id)).toBeNull()
  //     Received: <account B's proposal, including its evidence>
  it("the account filter is the only tenant barrier — none of the three read accessors leak across accounts (mutation: drop .eq(\"account_id\", accountId) from listPendingProposals/listProposalsForCall/getProposal -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      const callA = await seedCall(dbA, accountA);
      const propA = await insertProposal(dbA, accountA, {
        callId: callA, kind: "task", evidence: "A's caller asked for a callback",
        payload: { title: "Call A back", dueAt: null },
      });
      expect(propA).not.toBeNull();

      await withTestAccount(async (dbB, accountB) => {
        const callB = await seedCall(dbB, accountB);
        const propB = await insertProposal(dbB, accountB, {
          callId: callB, kind: "task", evidence: "B's caller asked for a callback",
          payload: { title: "Call B back", dueAt: null },
        });
        expect(propB).not.toBeNull();

        const pendingA = await listPendingProposals(dbA, accountA);
        expect(pendingA.map((p) => p.id)).toEqual([propA!.id]);

        expect(await listProposalsForCall(dbA, accountA, callB)).toEqual([]);

        expect(await getProposal(dbA, accountA, propB!.id)).toBeNull();
      });
    });
  });

  // Important 3. `listPendingProposals` is otherwise only ever asserted
  // AFTER a decide, where the table is legitimately empty — a stub
  // `return []` would pass that check and every other test in this file.
  // Proved live: hard-coding `listPendingProposals` to `return []`
  // (call-proposals.ts:126-137) fails the `toHaveLength(1)` line below with
  // "Expected length: 1, Received length: 0".
  it("listPendingProposals returns the pending proposal before it is decided, and none after", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      const before = await listPendingProposals(db, accountId);
      expect(before).toHaveLength(1);
      expect(before[0]!.id).toBe(p!.id);
      expect(before[0]!.status).toBe("pending");

      expect(await markProposalDecided(db, accountId, p!.id, "accepted", "user_x")).toBe(true);
      expect(await listPendingProposals(db, accountId)).toHaveLength(0);
    });
  });

  // Important 5, runtime half. Round-trips each kind with its OWN payload
  // shape and narrows on `kind` to reach it without a cast. The compile-time
  // half — that a MISMATCHED kind/payload pair cannot be constructed at
  // all — is proved below this describe block, at module scope, since it is
  // a property of the type system rather than something that runs.
  it("round-trips each kind with its own payload shape", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const task = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "the caller asked to be called back Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      const contactField = await insertProposal(db, accountId, {
        callId, kind: "contact_field", evidence: "the caller spelled her email out loud",
        payload: { field: "email", value: "dan@example.com" },
      });
      const stage = await insertProposal(db, accountId, {
        callId, kind: "opportunity_stage", evidence: "the caller agreed to move forward",
        payload: { opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2" },
      });
      expect(task).not.toBeNull();
      expect(contactField).not.toBeNull();
      expect(stage).not.toBeNull();

      const rows = await listProposalsForCall(db, accountId, callId);
      const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
      expect(byKind.task!.payload).toEqual({ title: "Call back Tuesday", dueAt: null });
      expect(byKind.contact_field!.payload).toEqual({ field: "email", value: "dan@example.com" });
      expect(byKind.opportunity_stage!.payload).toEqual({
        opportunityId: "opp_1", fromStageId: "stage_1", toStageId: "stage_2",
      });

      // Narrowing on `kind` reaches the matching payload type without a
      // cast — this is a compile-time property; the assertion below is
      // what makes the narrowed access exercise something at runtime too.
      const proposal = byKind.contact_field!;
      if (proposal.kind === "contact_field") {
        expect(proposal.payload.field).toBe("email");
      } else {
        throw new Error("expected the contact_field row to narrow to contact_field");
      }
    });
  });

  // Important 6. `insertProposal` must tell an expected refusal (23505,
  // 23514) apart from a real fault so a total outage of this feature does
  // not read in the logs as a pass with nothing to propose. A foreign key
  // violation (23503, an unknown call_id) is neither sanctioned refusal, so
  // it must land on the "unexpected fault" branch, named by code.
  //
  // Proved live: reverting insertProposal to the single-branch form (always
  // logging "insertProposal: refused for call ...") makes both assertions
  // below fail —
  //   expect(messages.some((m) => m.includes("unexpected fault"))).toBe(true)
  //     Received: false
  //   expect(messages.some((m) => m.includes("23503"))).toBe(true)
  //     Received: false
  // — because the single log line names neither.
  it("insertProposal logs an UNEXPECTED fault differently from a sanctioned refusal (mutation: collapse the two branches back into one -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const unknownCallId = "00000000-0000-0000-0000-0000000000fe";
        const result = await insertProposal(db, accountId, {
          callId: unknownCallId, kind: "task", evidence: "call me Tuesday",
          payload: { title: "Call back Tuesday", dueAt: null },
        });
        expect(result).toBeNull();
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.some((m) => m.includes("unexpected fault"))).toBe(true);
        expect(messages.some((m) => m.includes("23503"))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// Important 5, compile-time half. `kind` and `payload` must be
// unrepresentable when mismatched — this function is never called; its
// only job is to fail `tsc --noEmit` if that guarantee is ever loosened.
//
// Proved live in the direction that matters: with `insertProposal`'s
// parameter typed as the bare `{ kind: ProposalKind; payload: ProposalPayload }`
// it used to carry, THIS EXACT call typechecked cleanly, so the
// `@ts-expect-error` below was unused and `tsc --noEmit` reported
// TS2578 ("Unused '@ts-expect-error' directive") on this line — the
// by-name compiler red for this half of Important 5. Restoring
// `ProposalInput` makes the mismatch a real error again, which is what
// the directive is there to expect.
function _typeOnly_taskCannotCarryAnOpportunityStagePayload(
  db: SupabaseClient, accountId: string,
): void {
  const bad: ProposalInput = {
    kind: "task",
    // @ts-expect-error kind "task" cannot carry an OpportunityStagePayload
    payload: { opportunityId: "x", fromStageId: "y", toStageId: "z" },
  };
  void insertProposal(db, accountId, { callId: "unused", evidence: "unused", ...bad });
}
