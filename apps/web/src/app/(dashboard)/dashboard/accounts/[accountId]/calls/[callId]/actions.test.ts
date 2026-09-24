import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../../../../../../e2e/fixtures/production-guard";

// `apps/web`'s test script runs with this directory as cwd, and its
// credentials live in `.env.local`, not the `.env` that `dotenv/config`
// loads by default (same reason `f/[publicId]/actions.returning-lead.test.ts`
// spells the path out).
loadEnv({ path: ".env.local" });
// This suite creates and deletes real accounts. Where .env.local still names
// production (docs/runbooks/ci-supabase-project.md, section 9), refuse before
// anything is created. Policed by e2e/fixtures/production-guard.test.ts.
refuseProduction(process.env, "calls/[callId]/actions.test.ts");

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
  setOpportunityStatus, deleteAccountCascade, ACCOUNT_OWNED_TABLES,
} from "@bis/db";
import { acceptProposal, dismissProposal } from "./actions";
import { m } from "@/lib/messages";

// This suite runs against the LIVE shared Supabase project and each test
// makes three or more round trips. On vitest's 5s default it went red FOUR
// times on 2026-09-20 — twice on main, twice on a branch — every time with
// "Test timed out in 5000ms" on tests that pass alone, whenever CI's db
// suite, a local gate run or the e2e suite touched the same project at once.
// A 30s ceiling still fails a genuine hang; it stops a slow-but-correct test
// failing under load. The real fix is a CI project separate from
// production's — recorded in the ledger as the owner's call.
vi.setConfig({ testTimeout: 30_000 });

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

beforeEach(async () => {
  dbForRequestMock.mockImplementation(async () => serviceDb());
  // `revalidatePath` is ONE `vi.fn()` shared by the whole file (the mock
  // factory above runs once). Without a reset, a test that queues a
  // `mockImplementationOnce` throw but then — because of the very mutation
  // being tested — never actually calls it, leaks that queued throw into
  // whichever unrelated test calls `revalidatePath` next. Proved: removing
  // accept's `revalidatePath` calls made the accept "revalidate boom" test
  // pass (nothing to throw from) and reddened dismiss's own revalidatePath
  // test instead, with a confusing failure that had nothing to do with
  // dismiss.
  const cache = await import("next/cache");
  vi.mocked(cache.revalidatePath).mockReset();
});

/** The tables `deleteAccountCascade` must delete BY `account_id` for this
 *  fixture — not "every table this file's fixture writes to": this file also
 *  writes `call_proposals`, which is deliberately OFF `ACCOUNT_OWNED_TABLES`
 *  because it rides `calls`' own `on delete cascade` via `call_id` rather than
 *  being deleted by `account_id` (see `packages/db/src/account-teardown.ts:43-52`),
 *  so it belongs off this list too. The test below pins this list as a subset
 *  of `ACCOUNT_OWNED_TABLES`, so removing one of these from the shared list
 *  fails HERE rather than as a foreign-key error on the accounts delete at the
 *  end of an unrelated run. */
const TABLES_THE_CASCADE_MUST_DELETE_BY_ACCOUNT_ID = [
  "calls", "events", "contact_tags", "notes", "tasks",
  "opportunities", "pipeline_stages", "pipelines", "contacts", "phone_numbers",
] as const;

it("the shared cascade still covers every table this fixture needs deleted by account_id", () => {
  const covered = new Set<string>(ACCOUNT_OWNED_TABLES);
  expect(TABLES_THE_CASCADE_MUST_DELETE_BY_ACCOUNT_ID.filter((t) => !covered.has(t))).toEqual([]);
});

/** Throwaway account, cleaned up in `finally` by packages/db's OWN
 *  `deleteAccountCascade` — the same FK-ordered list `withTestAccount` uses,
 *  now that `@bis/db` exports it. It used to be a private copy of that list
 *  here, because the package only exported "." and its test fixtures are not
 *  a public subpath; a private copy of a 26-entry FK-ordered list is a bug
 *  with a delivery date, and the copy in
 *  `f/[publicId]/actions.returning-lead.test.ts` had already proved it by
 *  going stale and stranding 11 accounts. The cascade is a strict superset of
 *  what this file writes (pinned above), so nothing is lost by deferring to
 *  it. Must never go near the seeded "Test Client One" account. */
async function withTestAccount(fn: (db: Db, accountId: string) => Promise<void>) {
  const db = serviceDb();
  const orgId = `org_test_${Math.random().toString(36).slice(2, 10)}`;
  const { id: accountId } = await createAccount(
    db, { clerkOrgId: orgId, name: "Fixture Co (call proposals)", actorId: "user_test" });
  try {
    await fn(db, accountId);
  } finally {
    await deleteAccountCascade(db, accountId, "calls/[callId]/actions.test.ts");
  }
}

/** A `phone_numbers.e164` unique to this process — see `fixtures.ts`'s
 *  `testPhoneNumber` for the full reasoning (not importable here: same
 *  package-exports restriction). `+999` is assigned to no real country. */
function testPhoneNumber(): string {
  return `+999${String(Math.floor(Math.random() * 1_000_000_000_000)).padStart(12, "0")}`;
}

/**
 * Wraps a real client so any INSERT into `events` fails, while every other
 * table passes straight through to the real client untouched. This forces
 * `emit`'s own write (the SECOND of `addTask`/`fillContactBlanks`/
 * `moveOpportunityToStage`'s two non-transactional round-trips) to fail
 * AFTER the first one has already landed for real — no `@bis/db` mocking
 * involved, just a client that lies about one table.
 */
function dbWithFailingEventsInsert(real: Db): Db {
  return {
    from: (table: string) => {
      if (table === "events") {
        return { insert: () => Promise.resolve({ error: { message: "injected: events insert failed" } }) };
      }
      return real.from(table as never);
    },
  } as unknown as Db;
}

/**
 * Wraps a real client so `revertToPending`'s own UPDATE — identified by its
 * distinctive `status: "pending"` payload, which `markProposalDecided`'s
 * own CAS never sends — runs `race()` first, then performs the SAME update
 * for real (same values, same `.eq(...)` filters) via the real client.
 * `race()` simulates a legitimate second decision landing in the gap
 * between this accept's own compare-and-swap and its compensating revert,
 * a gap nothing in the source closes atomically. Reads and every other
 * table pass straight through untouched.
 */
function dbWithRaceBeforeRevert(real: Db, race: () => Promise<void>): Db {
  return {
    from: (table: string) => {
      if (table !== "call_proposals") return real.from(table as never);
      return {
        select: (cols: string) => real.from("call_proposals").select(cols),
        update: (values: Record<string, unknown>) => {
          if (values.status !== "pending") return real.from("call_proposals").update(values);
          const eqs: [string, unknown][] = [];
          const chain = {
            eq: (col: string, val: unknown) => { eqs.push([col, val]); return chain; },
            select: async (cols: string) => {
              await race();
              let q = real.from("call_proposals").update(values);
              for (const [col, val] of eqs) q = q.eq(col, val);
              return q.select(cols);
            },
          };
          return chain;
        },
      };
    },
  } as unknown as Db;
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
    "refuses a proposal another reviewer already decided, caught by the plain READ before any CAS " +
    "runs, and writes NOTHING (the CAS-return-check mutation is NOT pinned here — this scenario never " +
    "reaches markProposalDecided at all, since the status !== \"pending\" read above it already refuses; " +
    "that mutation is pinned by \"decides BEFORE it writes\" below, whose concurrent CAS race is the only " +
    "scenario where both callers pass the read and the CAS itself has to be the one that decides)",
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

  // Fix-wave Important 4: a proposal generated while the deal was open can
  // sit pending past the point a human closes it (won or lost) WITHOUT
  // moving its stage at all — the common case, since closing a deal is a
  // status change, not a board move. Before this fix, the re-read checked
  // only `stage_id`, so a same-stage closed opportunity sailed straight
  // through to `moveOpportunityToStage`, silently reopening a decided deal's
  // stage. `proposals.stageMoved` would also be a FALSE message here — the
  // stage never moved; the deal closed — hence its own key.
  it(
    "refuses an opportunity_stage accept whose opportunity has since been closed, even though its stage " +
    "never moved, leaving the proposal pending and the stage unchanged " +
    "(mutation: drop the re-read's status check -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(db, accountId, { firstName: "Close" }, "user_test");
        const { pipelineId } = await ensureDefaultPipeline(db, accountId);
        const { id: oppId } = await createOpportunity(
          db, accountId, { contactId, pipelineId, name: "Roof repair", value: 900 }, "user_test");
        const board = await listBoard(db, accountId, pipelineId);
        const [stage0, stage1] = board.map((b) => b.stage.id);
        expect(stage0).toBeTruthy();
        expect(stage1).toBeTruthy();

        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "opportunity_stage",
          evidence: "the caller agreed to move forward",
          payload: { opportunityId: oppId, fromStageId: stage0!, toStageId: stage1! },
        });
        expect(proposal).not.toBeNull();

        // A human closed the deal before anyone answered the suggestion —
        // its `stage_id` is untouched, only `status` changed.
        await setOpportunityStatus(db, accountId, oppId, "lost", "user_other");

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.opportunityClosed"] });

        const { data: opp } = await db.from("opportunities")
          .select("stage_id, status").eq("id", oppId).single();
        expect(opp!.stage_id).toBe(stage0);
        expect(opp!.status).toBe("lost");

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("pending");
      });
    },
  );

  it(
    "moves the opportunity through moveOpportunityToStage, not a bespoke insert — the trusted path's own " +
    "event proves it (mutation: replace moveOpportunityToStage with a raw opportunities.update({stage_id}) " +
    "-> the opportunity.stage_changed event assertion FAILS)",
    async () => {
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

        // The event is what proves the TRUSTED path ran — a bespoke update
        // would move the stage above but never emit this, and would also
        // skip moveOpportunityToStage's own "stage not in pipeline" check.
        const { data: events, error: eErr } = await db.from("events")
          .select("type, payload").eq("account_id", accountId).eq("type", "opportunity.stage_changed");
        expect(eErr).toBeNull();
        expect(events).toHaveLength(1);
        expect((events![0]!.payload as Record<string, unknown>).opportunityId).toBe(oppId);
      });
    },
  );

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

        // Pins the READ scope on its own: dropping `.eq("account_id", ...)`
        // from either `getProposal` alone or `markProposalDecided` alone
        // still leaves the conjunction above green (the other one still
        // refuses); only this direct assertion catches `getProposal` losing
        // its own account scope.
        const crossRead = await getProposal(dbB, accountB, proposal!.id);
        expect(crossRead).toBeNull();

        // Sanity: the SAME proposal, addressed with its OWN account, works —
        // proving the refusal above is the account scope, not a broken id.
        const right = await acceptProposal(accountA, callA, proposal!.id);
        expect(right).toEqual({ ok: true });
      });
    });
  });

  it(
    "a CRM write whose own INSERT fails is STILL treated as ambiguous, by deliberate decision — the " +
    "line is drawn at 'did the write helper get called', not at which of ITS OWN two round-trips " +
    "actually failed, because telling the two apart from the caller's side is exactly the cleverness " +
    "this design refuses in exchange for a guarantee that never varies: never duplicate " +
    "(mutation: special-case this failure back to a safe revert -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        // No mock: `due_at` is a real `timestamptz` column and this string
        // is not a valid timestamp, so `addTask`'s own INSERT genuinely
        // throws before any row lands — the same class of failure as a
        // dropped connection or a statement timeout, produced without
        // touching `@bis/db` at all. In hindsight this ONE was actually
        // safe to revert (nothing landed) — but the decision this test
        // pins is that the code does not try to tell hindsight-safe throws
        // apart from the FOLLOW-UP-emit-fails test below, where something
        // WAS written and reverting would be exactly wrong. Same code path,
        // same real cost accepted on purpose: an accepted proposal that
        // stays stuck even though, this one time, giving it back would
        // have been fine.
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back Tuesday", dueAt: "not-a-real-date" },
        });
        expect(proposal).not.toBeNull();

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.maybeFailed"] });

        const { data: tasks } = await db.from("tasks").select("id")
          .eq("account_id", accountId).eq("title", "Call back Tuesday");
        expect(tasks).toHaveLength(0);

        // Left ACCEPTED, not given back — even though, for this specific
        // failure, giving it back would have been safe. The design does
        // not know that from where it stands, and refuses to guess.
        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("accepted");
        expect(after!.decidedBy).toBe("user_test");

        // The stranded cost, made concrete: a retry — even one carrying a
        // fixed, valid `dueAt` this time — can no longer create the task
        // this proposal was always meant to produce, because the proposal
        // itself is no longer `pending`.
        const { error: fixErr } = await db.from("call_proposals")
          .update({ payload: { title: "Call back Tuesday", dueAt: null } })
          .eq("id", proposal!.id);
        expect(fixErr).toBeNull();

        const retry = await acceptProposal(accountId, callId, proposal!.id);
        expect(retry).toEqual({ ok: false, error: m["proposals.gone"] });

        const { data: tasksAfterRetry } = await db.from("tasks").select("id")
          .eq("account_id", accountId).eq("title", "Call back Tuesday");
        expect(tasksAfterRetry).toHaveLength(0);
      });
    },
  );

  it(
    "a CRM write that LANDS but whose follow-up event emit throws leaves the proposal ACCEPTED, not " +
    "reverted — so a retry cannot create a second record " +
    "(mutation: revert on every write-helper throw, ambiguous or not -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back Tuesday (ambiguous)", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        // `addTask` is two round-trips (packages/db/src/activities.ts): the
        // real `tasks` INSERT, then `emit`'s own INSERT into `events`. This
        // makes only the SECOND one fail — for real, no `@bis/db` mocking —
        // so the task row lands but the call reporting success does not.
        dbForRequestMock.mockImplementationOnce(async () => dbWithFailingEventsInsert(serviceDb()));

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.maybeFailed"] });

        const { data: tasksAfterFirst } = await db.from("tasks").select("id")
          .eq("account_id", accountId).eq("title", "Call back Tuesday (ambiguous)");
        expect(tasksAfterFirst).toHaveLength(1);

        // Left ACCEPTED, not given back — giving it back would invite the
        // very retry that creates a SECOND task on top of the one that
        // already landed.
        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("accepted");
        expect(after!.decidedBy).toBe("user_test");

        const retry = await acceptProposal(accountId, callId, proposal!.id);
        expect(retry).toEqual({ ok: false, error: m["proposals.gone"] });

        const { data: tasksAfterRetry } = await db.from("tasks").select("id")
          .eq("account_id", accountId).eq("title", "Call back Tuesday (ambiguous)");
        expect(tasksAfterRetry).toHaveLength(1);
      });
    },
  );

  it(
    "a revert scoped to THIS decision never claws back a different, later, legitimate accept of the " +
    "same proposal (mutation: drop the decided_by predicate on the revert -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        // No contactId: a pre-write refusal that must revert, giving a
        // deterministic hook onto that exact UPDATE via the wrapper below.
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "contact_field", evidence: "the caller spelled her email out loud",
          payload: { field: "email", value: "lead@example.com" },
        });
        expect(proposal).not.toBeNull();

        dbForRequestMock.mockImplementationOnce(async () => dbWithRaceBeforeRevert(serviceDb(), async () => {
          // Simulates a legitimate second decision landing in the gap
          // between this accept's own CAS and its compensating revert.
          const { error } = await serviceDb().from("call_proposals")
            .update({ decided_by: "user_other" }).eq("id", proposal!.id);
          if (error) throw new Error(error.message);
        }));

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.failed"] });

        const after = await getProposal(db, accountId, proposal!.id);
        // The revert must NOT have matched: the row still shows the OTHER
        // decider and stays accepted, never clawed back to pending.
        expect(after!.status).toBe("accepted");
        expect(after!.decidedBy).toBe("user_other");
      });
    },
  );

  it(
    "a revert scoped to status = 'accepted' never claws back a proposal that already moved on " +
    "(mutation: drop the status predicate on the revert -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "contact_field", evidence: "the caller spelled her email out loud",
          payload: { field: "email", value: "lead@example.com" },
        });
        expect(proposal).not.toBeNull();

        dbForRequestMock.mockImplementationOnce(async () => dbWithRaceBeforeRevert(serviceDb(), async () => {
          // Simulates the SAME decider's stamp having already moved on
          // (dismissed through some other path) by the time the revert
          // would run.
          const { error } = await serviceDb().from("call_proposals")
            .update({ status: "dismissed" }).eq("id", proposal!.id);
          if (error) throw new Error(error.message);
        }));

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.failed"] });

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("dismissed");
      });
    },
  );

  it(
    "returns an error instead of throwing when there is no session " +
    "(mutation: move dbForRequest back outside the try -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        dbForRequestMock.mockImplementationOnce(async () => {
          throw new Error("dbForRequest: no Clerk token on this request");
        });

        // `.resolves` itself proves the no-throw contract: if the promise
        // REJECTS instead, this assertion fails before comparing values.
        await expect(acceptProposal(accountId, callId, proposal!.id)).resolves.toEqual(
          { ok: false, error: m["proposals.failed"] },
        );
      });
    },
  );

  it(
    "a double-click on an already-accepted opportunity_stage proposal says someone already answered, " +
    "not that the board moved (mutation: drop the status===pending guard -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(db, accountId, { firstName: "Click" }, "user_test");
        const { pipelineId } = await ensureDefaultPipeline(db, accountId);
        const { id: oppId } = await createOpportunity(
          db, accountId, { contactId, pipelineId, name: "Fence 2", value: 800 }, "user_test");
        const board = await listBoard(db, accountId, pipelineId);
        const [stage0, stage1] = board.map((b) => b.stage.id);

        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "opportunity_stage",
          evidence: "the caller agreed to move forward",
          payload: { opportunityId: oppId, fromStageId: stage0!, toStageId: stage1! },
        });
        expect(proposal).not.toBeNull();

        const first = await acceptProposal(accountId, callId, proposal!.id);
        expect(first).toEqual({ ok: true });

        // Double click: the stage the FIRST accept just moved it to now
        // disagrees with `fromStageId`, but the true reason is that this
        // proposal was already decided, not that the board moved.
        const second = await acceptProposal(accountId, callId, proposal!.id);
        expect(second).toEqual({ ok: false, error: m["proposals.gone"] });
      });
    },
  );

  it(
    "refuses an opportunity_stage proposal whose opportunity was deleted, distinct from one that only moved " +
    "(mutation: collapse `!data` back into the stageMoved branch -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(db, accountId, { firstName: "Gone" }, "user_test");
        const { pipelineId } = await ensureDefaultPipeline(db, accountId);
        const { id: oppId } = await createOpportunity(
          db, accountId, { contactId, pipelineId, name: "Deleted deal", value: 500 }, "user_test");
        const board = await listBoard(db, accountId, pipelineId);
        const [stage0, stage1] = board.map((b) => b.stage.id);

        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "opportunity_stage",
          evidence: "the caller agreed to move forward",
          payload: { opportunityId: oppId, fromStageId: stage0!, toStageId: stage1! },
        });
        expect(proposal).not.toBeNull();

        const { error: delErr } = await db.from("opportunities").delete().eq("id", oppId);
        expect(delErr).toBeNull();

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.opportunityGone"] });

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("pending");
      });
    },
  );

  it(
    "refuses a lastName proposal that doesn't match the name already on file, distinct from an " +
    "already-filled field (mutation: report contactFilled for both reasons -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const { id: contactId } = await createContact(db, accountId, { firstName: "Roberto" }, "user_test");
        const proposal = await insertProposal(db, accountId, {
          callId, contactId, kind: "contact_field",
          evidence: "the caller spelled her last name",
          payload: { field: "lastName", value: "Garcia" },
        });
        expect(proposal).not.toBeNull();

        const r = await acceptProposal(accountId, callId, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.contactMismatch"] });

        const contact = await getContact(db, accountId, contactId);
        expect(contact!.last_name).toBeNull();

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("pending");
      });
    },
  );

  it(
    "refuses when the proposal doesn't belong to the given call, and does not act on it " +
    "(mutation: drop the callId check -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callA = await seedCall(db, accountId);
        const callB = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId: callA, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back for A", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const r = await acceptProposal(accountId, callB, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.gone"] });

        const { data: tasks } = await db.from("tasks").select("id").eq("account_id", accountId);
        expect(tasks).toHaveLength(0);

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("pending");
      });
    },
  );

  it(
    "does not throw to the client and does not revert the proposal when revalidatePath fails " +
    "after a successful write (mutation: move revalidatePath back outside the try -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Revalidate boom", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const cache = await import("next/cache");
        vi.mocked(cache.revalidatePath).mockImplementationOnce(() => {
          throw new Error("revalidate boom");
        });

        await expect(acceptProposal(accountId, callId, proposal!.id)).resolves.toEqual({ ok: true });

        const { data: tasks } = await db.from("tasks").select("id")
          .eq("account_id", accountId).eq("title", "Revalidate boom");
        expect(tasks).toHaveLength(1);

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("accepted");
      });
    },
  );
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

  it(
    "refuses a proposal that doesn't belong to the given call, and does not act on it " +
    "(mutation: drop dismiss's callId check -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callA = await seedCall(db, accountId);
        const callB = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId: callA, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Call back for A", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const r = await dismissProposal(accountId, callB, proposal!.id);
        expect(r).toEqual({ ok: false, error: m["proposals.gone"] });

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("pending");
      });
    },
  );

  it(
    "does not throw to the client and does not undo the dismiss when revalidatePath fails after a " +
    "successful write (mutation: move dismiss's revalidatePath calls back outside the try -> FAILS)",
    async () => {
      await withTestAccount(async (db, accountId) => {
        const callId = await seedCall(db, accountId);
        const proposal = await insertProposal(db, accountId, {
          callId, kind: "task", evidence: "the caller asked to be called back",
          payload: { title: "Dismiss revalidate boom", dueAt: null },
        });
        expect(proposal).not.toBeNull();

        const cache = await import("next/cache");
        vi.mocked(cache.revalidatePath).mockImplementationOnce(() => {
          throw new Error("revalidate boom");
        });

        await expect(dismissProposal(accountId, callId, proposal!.id)).resolves.toEqual({ ok: true });

        const after = await getProposal(db, accountId, proposal!.id);
        expect(after!.status).toBe("dismissed");
      });
    },
  );
});
