import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { config as loadEnv } from "dotenv";

// `apps/web`'s test script runs with this directory as cwd, and its
// credentials live in `.env.local`, not the `.env` that `dotenv/config`
// loads by default (same reason `f/[publicId]/actions.returning-lead.test.ts`
// spells the path out).
loadEnv({ path: ".env.local" });

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_test", isAgency: true }),
}));

const dbForRequestMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ dbForRequest: dbForRequestMock }));

/**
 * Deliberately NOT mocking `@bis/db` (contrast with `tasks/actions.test.ts`,
 * which mocks it entirely). This suite proves the boundary where a proposal
 * becomes a real CRM record — the CAS in `markProposalDecided`, the trusted
 * write paths' own event emission, the blank-check in `fillContactBlanks` —
 * none of which a mock of those functions could exercise. `dbForRequest` is
 * mocked only because it needs a live Clerk request to resolve for real; it
 * resolves to `serviceDb()` instead, which is why every test here proves
 * BEHAVIOUR against a real throwaway account, not the RLS/grants boundary a
 * signed-in browser session would be subject to. That boundary is out of
 * scope for this file (see the report).
 */
import {
  serviceDb, createAccount, createContact, getContact,
  insertProposal, getProposal, markProposalDecided,
  ensureDefaultPipeline, createOpportunity, listBoard, moveOpportunityToStage,
} from "@bis/db";
import { acceptProposal, dismissProposal } from "./actions";
import { m } from "@/lib/messages";

// Not `SupabaseClient` from `@supabase/supabase-js` directly: apps/web has no
// dependency on that package (only `@bis/db` does), so naming it here fails
// `tsc` with "Cannot find module" even though it happens to resolve at
// test/build time via pnpm's hoisting. `lib/proposals/generate.ts` hits the
// same boundary and solves it the same way: alias the type off the one
// function whose declared return type IS `SupabaseClient`.
type Db = ReturnType<typeof serviceDb>;

beforeAll(() => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing — this suite needs apps/web/.env.local");
  }
});

beforeEach(() => {
  dbForRequestMock.mockImplementation(async () => serviceDb());
});

/** Throwaway account, cleaned up in `finally` — mirrors packages/db's
 *  `withTestAccount`/`account-teardown.ts`'s `ACCOUNT_OWNED_TABLES`,
 *  reimplemented locally because `@bis/db`'s package.json only exports "."
 *  (its own test fixtures are not a public subpath — same reason
 *  `f/[publicId]/actions.returning-lead.test.ts` reimplements it too). Order
 *  mirrors that list's relative order for the tables this file touches:
 *  `calls` before `phone_numbers` (calls FK-references phone_numbers).
 *  Must never go near the seeded "Test Client One" account. */
async function withTestAccount(fn: (db: Db, accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id: accountId } = await createAccount(
    db, { clerkOrgId: orgId, name: "Fixture Co (call proposals)", actorId: "user_test" });
  try {
    await fn(db, accountId);
  } finally {
    for (const table of [
      "calls", "events", "contact_tags", "notes", "tasks",
      "opportunities", "pipeline_stages", "pipelines", "contacts", "phone_numbers",
    ]) {
      const { error } = await db.from(table).delete().eq("account_id", accountId);
      if (error) throw new Error(`test cleanup: ${table} delete failed: ${error.message}`);
    }
    const { error } = await db.from("accounts").delete().eq("id", accountId);
    if (error) throw new Error(`test cleanup: accounts delete failed: ${error.message}`);
  }
}

/** A `phone_numbers.e164` unique to this process — see `fixtures.ts`'s
 *  `testPhoneNumber` for the full reasoning (not importable here: same
 *  package-exports restriction). `+999` is assigned to no real country. */
function testPhoneNumber(): string {
  return `+999${String(Math.floor(Math.random() * 1_000_000_000_000)).padStart(12, "0")}`;
}

async function seedCall(db: Db, accountId: string): Promise<string> {
  const num = await db.from("phone_numbers")
    .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
  if (num.error) throw new Error(`phone_numbers insert failed: ${num.error.message}`);
  const call = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: num.data!.id, caller_e164: "+19562921696" })
    .select("id").single();
  if (call.error) throw new Error(`calls insert failed: ${call.error.message}`);
  return call.data!.id as string;
}

describe("acceptProposal", () => {
  it(
    "creates a task through addTask, not a bespoke insert — the trusted path's own event proves it " +
    "(mutation: replace addTask with a raw insert -> the task.created event assertion FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(db, accountId, { firstName: "Ring" }, "user_test");
        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "task",
          evidence: "the caller asked to be called back Tuesday",
          payload: { title: "Call back Tuesday", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: true });

        const { data: tasks, error: tErr } = await db.from("tasks")
          .select("id, title, contact_id")
          .eq("account_id", accountId).eq("title", "Call back Tuesday");
        expect(tErr).toBeNull();
        expect(tasks).toHaveLength(1);
        expect(tasks![0]!.contact_id).toBe(contactId);

        // The event is what proves the TRUSTED path ran — a bespoke insert
        // would produce the tasks row above but never this event, because
        // only `addTask` itself emits it.
        const { data: events, error: eErr } = await db.from("events")
          .select("type, payload").eq("account_id", accountId).eq("type", "task.created");
        expect(eErr).toBeNull();
        expect(events).toHaveLength(1);
        expect((events![0]!.payload as Record<string, unknown>).taskId).toBe(tasks![0]!.id);
      });
    },
  );

  it("marks the proposal accepted, stamping the acting user's id", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const proposal = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "the caller asked to be called back",
        payload: { title: "Call back", dueAt: null },
      });
      expect(proposal).not.toBeNull();

      const r = await acceptProposal(accountId, callId, proposal!.id);
      expect(r).toEqual({ ok: true });

      const after = await getProposal(db, accountId, proposal!.id);
      expect(after!.status).toBe("accepted");
      expect(after!.decidedBy).toBe("user_test");
      expect(after!.decidedAt).not.toBeNull();
    });
  });

  it(
    "refuses a proposal another reviewer already answered, and writes NOTHING " +
    "(mutation: drop the markProposalDecided return check -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back", dueAt: null },
        });
        expect(proposal).not.toBeNull();
        // Decide it first, as another reviewer racing this one would.
        expect(await markProposalDecided(db, accountId, proposal!.id, "accepted", "user_other")).toBe(true);

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.gone"] });

        const { data: tasks } = await db.from("tasks").select("id").eq("account_id", accountId);
        expect(tasks).toHaveLength(0);

        // The first decider's stamp survives untouched.
        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.decidedBy).toBe("user_other");
      });
    },
  );

  it(
    "decides BEFORE it writes, so a double accept creates exactly ONE task " +
    "(mutation: swap the decide/write order -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back twice?", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const results = await Promise.all([
          acceptProposal(accountId, callId, proposal!.id),
          acceptProposal(accountId, callId, proposal!.id),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toHaveLength(1);

        const { data: tasks } = await db.from("tasks").select("id")
          .eq("account_id", accountId).eq("title", "Call back twice?");
        expect(tasks).toHaveLength(1);
      });
    },
  );

  it("fills a blank contact field via fillContactBlanks and reports success", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Lead" }, "user_test");
      const proposal = await insertProposal(db, accountId, {
        callId, contactId, kind: "contact_field",
        evidence: "the caller spelled her email out loud",
        payload: { field: "email", value: "Lead@Example.com" },
      });
      expect(proposal).not.toBeNull();

      const r = await acceptProposal(accountId, callId, proposal!.id);
      expect(r).toEqual({ ok: true });

      const contact = await getContact(db, accountId, contactId);
      expect(contact!.email).toBe("lead@example.com");
    });
  });

  it(
    "refuses when the field was already filled in between, and leaves the hand-typed value untouched " +
    "(mutation: swap fillContactBlanks for updateContact -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(
          db, accountId, { firstName: "Lead", email: "hand-typed@example.com" }, "user_test");
        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "contact_field",
          evidence: "the caller spelled her email out loud",
          payload: { field: "email", value: "different@example.com" },
        });
        expect(proposal).not.toBeNull();

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.contactFilled"] });

        const contact = await getContact(db, accountId, contactId);
        expect(contact!.email).toBe("hand-typed@example.com");
      });
    },
  );

  it(
    "refuses an opportunity stage move whose fromStage no longer holds, leaving the proposal pending " +
    "and the stage unchanged (mutation: drop the re-read -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(db, accountId, { firstName: "Move" }, "user_test");
        const { pipelineId } = await ensureDefaultPipeline(db, accountId);
        const { id: oppId } = await createOpportunity(
          db, accountId, { contactId, pipelineId, name: "Deck build", value: 4500 }, "user_test");
        const board = await listBoard(db, accountId, pipelineId);
        const [stage0, stage1, stage2] = board.map((b) => b.stage.id);
        expect(stage0).toBeTruthy();
        expect(stage1).toBeTruthy();
        expect(stage2).toBeTruthy();

        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "opportunity_stage",
          evidence: "the caller agreed to move forward",
          payload: { opportunityId: oppId, fromStageId: stage0!, toStageId: stage1! },
        });
        expect(proposal).not.toBeNull();

        // The world moved before anyone answered the suggestion.
        await moveOpportunityToStage(db, accountId, oppId, stage2!, "user_other");

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.stageMoved"] });

        const { data: opp } = await db.from("opportunities")
          .select("stage_id").eq("id", oppId).single();
        expect(opp!.stage_id).toBe(stage2);

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("pending");
      });
    },
  );

  it("moves the opportunity when fromStage still matches", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Move2" }, "user_test");
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const { id: oppId } = await createOpportunity(
        db, accountId, { contactId, pipelineId, name: "Fence", value: 1200 }, "user_test");
      const board = await listBoard(db, accountId, pipelineId);
      const [stage0, stage1] = board.map((b) => b.stage.id);

      const proposal = await insertProposal(db, accountId, {
        callId, contactId, kind: "opportunity_stage",
        evidence: "the caller agreed to move forward",
        payload: { opportunityId: oppId, fromStageId: stage0!, toStageId: stage1! },
      });
      expect(proposal).not.toBeNull();

      const r = await acceptProposal(accountId, callId, proposal!.id);
      expect(r).toEqual({ ok: true });

      const { data: opp } = await db.from("opportunities")
        .select("stage_id").eq("id", oppId).single();
      expect(opp!.stage_id).toBe(stage1);
    });
  });

  it("refuses a proposal belonging to another account", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const callA = await seedCall(dbA, accountA);
        const proposal = await insertProposal(dbA, accountA, {
          callId: callA, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call A back", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const wrong = await acceptProposal(accountB, callA, proposal!.id);
        expect(wrong).toEqual({ ok: false, error: m["proposals.gone"] });

        const { data: tasksB } = await dbB.from("tasks").select("id").eq("account_id", accountB);
        expect(tasksB).toHaveLength(0);

        // Sanity: the SAME proposal, addressed with its OWN account, works —
        // proving the refusal above is the account scope, not a broken id.
        const right = await acceptProposal(accountA, callA, proposal!.id);
        expect(right).toEqual({ ok: true });
      });
    });
  });
});

describe("dismissProposal", () => {
  it(
    "keeps the row and marks it dismissed, never deletes it " +
    "(mutation: change the update to a delete -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const r = await dismissProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: true });

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after).not.toBeNull();
        expect(after!.status).toBe("dismissed");
      });
    },
  );

  it("refuses a proposal another reviewer already answered", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const proposal = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "the caller asked to be called back",
        payload: { title: "Call back", dueAt: null },
      });
      expect(proposal).not.toBeNull();
      expect(await markProposalDecided(db, accountId, proposal!.id, "dismissed", "user_other")).toBe(true);

      const r = await dismissProposal(accountId, callId, proposal!.id);
      expect(r).toEqual({ ok: false, error: m["proposals.gone"] });
    });
  });
});
