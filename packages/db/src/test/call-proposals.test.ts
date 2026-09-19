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
  getProposal, markProposalDecided, listPendingProposalsForAgency,
} from "../call-proposals";
import { listAccountWork, listAgencyWork } from "../work-queue";
import { addTask } from "../activities";

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

  // The companion test to Important 6 below: that one proves a FAULT (an
  // unknown FK) reaches the "unexpected fault" line. Nothing previously
  // proved a SANCTIONED REFUSAL (this CHECK violation) reaches the
  // "refused" line and stays OFF the fault line — a rewrite that routed
  // every error, refusal included, to "unexpected fault" left every
  // existing assertion here green, because none of them read the log line
  // at all.
  //
  // Proved live: changing `if (code === "23505" || code === "23514")` to
  // `if (code === "99999")` (call-proposals.ts:98) leaves both assertions
  // below failing —
  //   expect(messages.some((m) => m.includes("refused"))).toBe(true)
  //     Received: false
  //   expect(messages.some((m) => m.includes("unexpected fault"))).toBe(false)
  //     Received: true
  it("rejects an empty evidence string and logs it as a REFUSAL, not a fault (mutation: drop call_proposals_evidence_nonempty -> FAILS; mutation: route 23514 to the fault branch -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const callId = await seedCall(db, accountId);
        const created = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "   ",
          payload: { title: "Ungrounded", dueAt: null },
        });
        expect(created).toBeNull();
        const messages = spy.mock.calls.map((args) => String(args[0]));
        expect(messages.some((m) => m.includes("refused"))).toBe(true);
        expect(messages.some((m) => m.includes("unexpected fault"))).toBe(false);
      } finally {
        spy.mockRestore();
      }
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

// Work Queue Task 10 — the agency-wide screen (`/dashboard/work`) reads
// EVERY account's pending proposals in one pass, the same way
// `listAgencyWork` reads every account's tasks/conversations/bookings.
// Copies `listAgencyWork`'s own accounts-join shape (work-queue.ts:190-231):
// read the rows, collect the distinct account ids they carry, read only
// THOSE accounts' `brand_name`, resolve each through `brandDisplayName`
// (never a fallback to `accounts.name`), and attach the result per row.
describe("listPendingProposalsForAgency", () => {
  it("carries each account's own brand name, across two different accounts, and excludes a decided proposal", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        await dbA.from("accounts").update({ brand_name: "Acme HVAC" }).eq("id", accountA);
        await dbB.from("accounts").update({ brand_name: "Rio Roofing" }).eq("id", accountB);

        const callA = await seedCall(dbA, accountA);
        const pendingA = await insertProposal(dbA, accountA, {
          callId: callA, kind: "task", evidence: "A's caller asked for a callback",
          payload: { title: "Call A back", dueAt: null },
        });
        const callB = await seedCall(dbB, accountB);
        const pendingB = await insertProposal(dbB, accountB, {
          callId: callB, kind: "task", evidence: "B's caller asked for a callback",
          payload: { title: "Call B back", dueAt: null },
        });
        // A second proposal on B's own call, already decided — must be
        // excluded by `status = "pending"` the same way `listPendingProposals`
        // excludes it per-account.
        const decidedB = await insertProposal(dbB, accountB, {
          callId: callB, kind: "contact_field", evidence: "B's caller spelled her email",
          payload: { field: "email", value: "b@example.com" },
        });
        expect(await markProposalDecided(dbB, accountB, decidedB!.id, "accepted", "user_x")).toBe(true);

        // This screen is deliberately cross-tenant (like `listAgencyWork`),
        // and this suite shares ONE Supabase project with production — never
        // assert on the full result set, only on these fixtures' own rows,
        // by id.
        const rows = await listPendingProposalsForAgency(dbA);
        const byId = new Map(rows.map((r) => [r.id, r]));

        expect(byId.get(pendingA!.id)?.brandName).toBe("Acme HVAC");
        expect(byId.get(pendingB!.id)?.brandName).toBe("Rio Roofing");
        expect(byId.has(decidedB!.id)).toBe(false);
      });
    });
  });

  it("returns a blank brand name, never the account's internal label, when brand_name is null (mutation: fall back to accounts.name -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await db.from("accounts").update({ brand_name: null, name: "Fixture Co — internal" }).eq("id", accountId);
      const callId = await seedCall(db, accountId);
      const created = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      const rows = await listPendingProposalsForAgency(db);
      const mine = rows.find((r) => r.id === created!.id);
      expect(mine?.brandName).toBe("");
      expect(mine?.brandName).not.toContain("Fixture Co");
    });
  });
});

/**
 * THE PROOF THE WHOLE FEATURE'S SEPARATION EXISTS FOR (task-10-brief.md).
 *
 * A proposal is a QUESTION about work, not work — `bucketWork`,
 * `listAccountWork`'s own dashboard consumer (the account dashboard's work
 * row) and `listAgencyWork` must never learn to filter `call_proposals` out,
 * because that is only safe if nothing ever puts one in. Realistic fixtures
 * on purpose (same lesson `screened-calls.test.ts`'s own header comment
 * states): a real `account_id`, a real `call_id` (a genuine `calls` row via
 * `seedCall`, not a fixture the writer could not have produced), and a real
 * `contact_id` on one of the two — so a mutation that actually tried to fold
 * `call_proposals` into `listAccountWork`'s read could produce a row this
 * test would catch, not one it could never construct in the first place.
 *
 * Proved live (this task's report): temporarily editing `listAccountWork`
 * (work-queue.ts) to also map pending `call_proposals` rows into `WorkRow[]`
 * turns this test red by name; reverting turns it back green. Not left in
 * the file as an executable mutation (there is no dependency-injection seam
 * to swap `listAccountWork`'s own query from a test), the same shape
 * `screened-calls.test.ts`'s own "proved live" comments already use for a
 * mutation that has to be applied to the source and reverted, not run in CI.
 */
describe("call_proposals cannot contaminate the work queue", () => {
  it("leaves listAccountWork's and listAgencyWork's rows byte-identical, by id, before and after realistic pending proposals are seeded", async () => {
    await withTestAccount(async (db, accountId) => {
      // Real work already on the account, so "unchanged" is a real claim
      // about a nonzero baseline, not a trivial 0-equals-0.
      await addTask(db, accountId, { title: "Call Maria back" }, "user_test");
      const { data: contact, error: cErr } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Sam", last_name: "Rivera" })
        .select("id").single();
      expect(cErr, `contacts insert failed: ${cErr?.message}`).toBeNull();

      const before = await listAccountWork(db, accountId);
      const agencyBefore = (await listAgencyWork(db)).filter((r) => r.accountId === accountId);
      expect(before.length).toBeGreaterThan(0);

      // Realistic proposals: a real call (seedCall — a genuine phone_numbers
      // + calls row, not phoneNumberId: null), a real account_id, and a real
      // contact_id on one of the two, per the task-10 brief's own warning.
      const callId = await seedCall(db, accountId);
      await insertProposal(db, accountId, {
        callId, contactId: contact!.id as string, kind: "task",
        evidence: "the caller asked to be called back Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      await insertProposal(db, accountId, {
        callId, kind: "contact_field",
        evidence: "the caller spelled her email out loud",
        payload: { field: "email", value: "sam@example.com" },
      });

      const after = await listAccountWork(db, accountId);
      const agencyAfter = (await listAgencyWork(db)).filter((r) => r.accountId === accountId);

      expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
      expect(agencyAfter.map((r) => r.id).sort()).toEqual(agencyBefore.map((r) => r.id).sort());
    });
  });
});

// Important 5, compile-time half. `kind` and `payload` must be
// unrepresentable when mismatched, AT THE CALL SITE that actually matters —
// `insertProposal`'s own parameter type — not just on a standalone
// `ProposalInput`-typed variable that a caller need not ever name. This
// function is never called; its only job is to fail `tsc --noEmit` if that
// guarantee is ever loosened.
//
// Proved live in the direction that matters: with `insertProposal`'s
// parameter widened back to the pre-fix bare shape
// `{ callId; contactId?; evidence; kind: ProposalKind; payload: ProposalPayload }`,
// THIS EXACT call typechecked cleanly (`npx tsc --noEmit` exit 0, no
// diagnostics at all — including when the directive lived on a separate
// `const bad: ProposalInput` instead of here), so the `@ts-expect-error`
// below was unused and `tsc --noEmit` reports TS2578 ("Unused
// '@ts-expect-error' directive") on this line — the by-name compiler red
// this half of Important 5 requires. Restoring `insertProposal`'s narrowed
// parameter makes the mismatch a real error again, which is what the
// directive is there to expect.
function _typeOnly_taskCannotCarryAnOpportunityStagePayload(
  db: SupabaseClient, accountId: string,
): void {
  void insertProposal(db, accountId, {
    callId: "unused", evidence: "unused", kind: "task",
    // @ts-expect-error kind "task" cannot carry an OpportunityStagePayload
    payload: { opportunityId: "x", fromStageId: "y", toStageId: "z" },
  });
}
