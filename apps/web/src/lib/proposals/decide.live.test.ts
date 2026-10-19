import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../e2e/fixtures/production-guard";

// The live harness of `…/calls/[callId]/actions.test.ts` (deleted in Task 8), cut to what this file
// needs: `decide.ts` is called DIRECTLY with real clients, so neither `@/lib/auth` nor `@/lib/db` is
// mocked (nothing here imports them). apps/web's test script runs with this directory as cwd, and its
// credentials would live in `.env.local`; in this worktree that file does not exist and the replica
// kit's `env-run.sh` is what is sourced (plan "The replica kit"). dotenv never overrides a set variable.
loadEnv({ path: ".env.local" });
// This suite creates and deletes real accounts. Where the env still names production, refuse before
// anything is created (e2e/fixtures/production-guard.test.ts polices the guard).
refuseProduction(process.env, "lib/proposals/decide.live.test.ts");

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  serviceDb, createAccount, deleteAccountCascade, createContact, getContact, getProposal, insertProposal,
  decideProposal, ensureDefaultPipeline, createOpportunity, moveOpportunityToStage, setOpportunityStatus,
} from "@bis/db";
import { proposalExpiresAt, type ProposalInput } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import { acceptSuggestion, discardSuggestion, undoSuggestion, revalidateFor, type DecideDeps } from "./decide";

/**
 * Item 8b-1, Task 6: the decision module against a real database (plan deviation 21). Real PostgREST,
 * real compare-and-swaps, real write paths (`addTask`, `fillContactBlanksReport`,
 * `moveOpportunityToStage`, `deleteTaskForUndo`, `updateContact`) and their events. Both of a
 * decision's clients are the real SERVICE client here (the harness this copies): RLS on the request
 * client is the schema suite's and the e2e's to prove; this file proves the ORDER of the steps, the
 * compare-and-swaps and every answer. Consequence: `tasks.created_by` is stamped from a JWT's `sub`
 * (0073), which the service client has none of, so the person on a to-do is read off its `task.created`
 * event's `actor_id` instead.
 */

vi.setConfig({ testTimeout: 30_000 });

type Db = ReturnType<typeof serviceDb>;
const ZONE = "America/Chicago";
const RUN = Math.random().toString(36).slice(2, 8);
const ME = `user_decide_me_${RUN}`;
const ANA = `user_decide_ana_${RUN}`;
const NAMELESS = `user_decide_nameless_${RUN}`;
const DAY = 86_400_000;
const svc = (): Db => serviceDb();

beforeAll(async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing: source the replica kit's env-run.sh");
  const { error } = await svc().from("users").insert({ clerk_user_id: ANA, email: `ana-${RUN}@example.invalid`, name: "Ana López" });
  if (error) throw new Error(`users seed failed: ${error.message}`);
});
afterAll(async () => {
  const { error } = await svc().from("users").delete().eq("clerk_user_id", ANA);
  if (error) throw new Error(`users cleanup failed: ${error.message}`);
});
afterEach(() => { vi.restoreAllMocks(); });

function deps(accountId: string, over: Partial<DecideDeps> = {}): DecideDeps {
  const db = svc();
  return { db, writer: db, accountId, userId: ME, now: new Date(), zone: ZONE, tr: makeTr("en"), ...over };
}

async function withAccount(fn: (db: Db, accountId: string) => Promise<void>): Promise<void> {
  const db = svc();
  const { id } = await createAccount(db, { clerkOrgId: `org_test_${Math.random().toString(36).slice(2, 10)}`, name: "Fixture Co (decide)", actorId: "user_test" });
  try {
    await fn(db, id);
  } finally {
    await deleteAccountCascade(db, id, "lib/proposals/decide.live.test.ts");
  }
}

/** A call on the account's ONE active number (0063 refuses a second non-released one). */
async function seedCall(db: Db, accountId: string): Promise<string> {
  const held = await db.from("phone_numbers").select("id").eq("account_id", accountId).neq("status", "released").maybeSingle();
  if (held.error) throw new Error(held.error.message);
  let numberId = held.data?.id as string | undefined;
  if (!numberId) {
    const e164 = `+999${String(Math.floor(Math.random() * 1_000_000_000_000)).padStart(12, "0")}`;
    const n = await db.from("phone_numbers").insert({ account_id: accountId, e164 }).select("id").single();
    if (n.error) throw new Error(n.error.message);
    numberId = n.data!.id as string;
  }
  const c = await db.from("calls").insert({ account_id: accountId, phone_number_id: numberId, caller_e164: "+19562921696" }).select("id").single();
  if (c.error) throw new Error(c.error.message);
  return c.data!.id as string;
}

async function seedContact(db: Db, accountId: string, input: Parameters<typeof createContact>[2]): Promise<string> {
  return (await createContact(db, accountId, input, "user_test")).id;
}

/** As the generator writes one (`insertProposal`), with the evidence and its 30-day life. */
async function seed(
  db: Db, accountId: string,
  p: { callId: string; contactId?: string | null; expiresAt?: string } & ProposalInput,
): Promise<string> {
  const r = await insertProposal(db, accountId, {
    evidence: "the caller said so", evidenceRef: { turn: 1, at: new Date().toISOString() }, evidenceLang: "en",
    expiresAt: p.expiresAt ?? proposalExpiresAt(new Date()), ...p,
  });
  if (!r) throw new Error("seed refused");
  return r.id;
}

async function rowOf(db: Db, accountId: string, id: string) {
  const r = await getProposal(db, accountId, id);
  if (!r) throw new Error(`no proposal ${id}`);
  return r;
}

async function tasksTitled(db: Db, accountId: string, title: string) {
  const { data, error } = await db.from("tasks").select("id, title, due_at, completed_at").eq("account_id", accountId).eq("title", title);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function eventsOf(db: Db, accountId: string, type: string) {
  const { data, error } = await db.from("events").select("actor_id, actor_type, payload").eq("account_id", accountId).eq("type", type);
  if (error) throw new Error(error.message);
  return (data ?? []) as { actor_id: string | null; actor_type: string; payload: Record<string, unknown> }[];
}

async function stagesOf(db: Db, accountId: string) {
  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const { data, error } = await db.from("pipeline_stages").select("id, position").eq("account_id", accountId).eq("pipeline_id", pipelineId).order("position");
  if (error) throw new Error(error.message);
  return { pipelineId, ids: (data ?? []).map((s) => s.id as string) };
}

const dueIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const errorLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.map(String).join(" "));

/** A chain that answers `settle()` however it is continued (`.eq`, `.in`, `.select`, awaited). */
function settledChain(settle: () => Promise<unknown>): unknown {
  const chain: unknown = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => settle().then(ok, ko);
      return () => chain;
    },
  });
  return chain;
}
const rejecting = (msg: string) => () => settledChain(() => Promise.reject(new Error(msg)));
const matchingNothing = () => settledChain(() => Promise.resolve({ data: [], error: null }));

/** The REAL `update(values)` with every filter the caller chains, run only after `race()` has settled. */
function realAfter(real: Db, table: string, values: Record<string, unknown> | undefined, race: () => Promise<void>): unknown {
  const steps: [string, unknown[]][] = [];
  const chain: unknown = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => race().then(() => {
          let q = real.from(table).update(values ?? {}) as unknown as Record<string, (...a: unknown[]) => unknown>;
          for (const [m, args] of steps) q = q[m]!(...args) as typeof q;
          return q as unknown as PromiseLike<unknown>;
        }).then(ok, ko);
      }
      return (...args: unknown[]) => { steps.push([String(prop), args]); return chain; };
    },
  });
  return chain;
}

/**
 * `real`, except that `from(table)[method](values)` is answered by `answer` the first time `when(values)`
 * holds; every other call passes straight through. `stats.calls` counts every `method` call on `table`.
 */
function intercept(
  real: Db, table: string, method: "update" | "delete",
  when: (values: Record<string, unknown> | undefined) => boolean,
  answer: (values: Record<string, unknown> | undefined) => unknown,
): { client: Db; stats: { calls: number; fired: number } } {
  const stats = { calls: 0, fired: 0 };
  const client = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const builder = target.from(name);
        if (name !== table) return builder;
        return new Proxy(builder, {
          get(bt, bp, br) {
            const v = Reflect.get(bt, bp, br);
            if (bp !== method) return typeof v === "function" ? v.bind(bt) : v;
            return (values?: Record<string, unknown>, ...rest: unknown[]) => {
              stats.calls++;
              if (stats.fired === 0 && when(values)) { stats.fired++; return answer(values); }
              return (v as (...a: unknown[]) => unknown).call(bt, values, ...rest);
            };
          },
        });
      };
    },
  });
  return { client: client as Db, stats };
}

describe("revalidateFor", () => {
  it("names the call page, the To do page, the agency Work page and the customer's record page", () => {
    expect(revalidateFor("A", { callId: "c1", contactId: "k1" })).toEqual([
      "/dashboard/accounts/A/calls/c1", "/dashboard/accounts/A/tasks", "/dashboard/work", "/dashboard/accounts/A/contacts/k1",
    ]);
    expect(revalidateFor("A", { callId: null, contactId: null })).toEqual(["/dashboard/accounts/A/tasks", "/dashboard/work"]);
  });
});

describe("Accept", () => {
  it("1. a to-do writes through addTask: the task, its task.created event by the person, the row accepted with applied_* " +
    "(mutation: a direct tasks insert in place of kind.apply -> no event, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const dueAt = dueIn(3);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Call back about the fence", dueAt } });
      const d = deps(a);
      const r = await acceptSuggestion(d, id);
      expect(r).toEqual({ ok: true, status: "accepted", toast: "Added to your to-do list", target: { callId, contactId: null } });
      const tasks = await tasksTitled(db, a, "Call back about the fence");
      expect(tasks).toHaveLength(1);
      const created = await eventsOf(db, a, "task.created");
      expect(created).toHaveLength(1);
      expect(created[0]!.actor_id).toBe(ME);
      expect(created[0]!.payload.taskId).toBe(tasks[0]!.id);
      const row = await rowOf(db, a, id);
      expect(row.status).toBe("accepted");
      expect(row.decidedBy).toBe(ME);
      expect(Date.parse(row.decidedAt!)).toBe(d.now.getTime());
      expect(row.appliedPayload).toEqual({ title: "Call back about the fence", dueAt });
      expect(row.appliedRef).toEqual({ taskId: tasks[0]!.id, title: "Call back about the fence", dueAt, superseded: [], flagged: false });
    });
  });

  it("2. Edit and accept a phone: edited, the spoken form applied, the contact's E.164 written, before null; an edit equal " +
    "to the stored one is accepted with the STORED payload", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2] = [await seedCall(db, a), await seedCall(db, a)];
      const k1 = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId: c1, contactId: k1, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      const r = await acceptSuggestion(deps(a), id, { value: "899 000 0000" });
      expect(r).toMatchObject({ ok: true, status: "edited", toast: "Phone saved" });
      const row = await rowOf(db, a, id);
      expect(row.status).toBe("edited");
      expect(row.appliedPayload).toEqual({ field: "phone", value: "899 000 0000" });
      expect(row.appliedRef).toMatchObject({ field: "phone", before: null, value: "+528990000000" });
      expect((await getContact(db, a, k1))!.phone).toBe("+528990000000");

      const k2 = await seedContact(db, a, { firstName: "Luis" });
      const same = await seed(db, a, { callId: c2, contactId: k2, kind: "contact_field", payload: { field: "phone", value: "956 555 0102" } });
      const r2 = await acceptSuggestion(deps(a), same, { value: "  956 555 0102  " });
      expect(r2).toMatchObject({ ok: true, status: "accepted" });
      expect((await rowOf(db, a, same)).appliedPayload).toEqual({ field: "phone", value: "956 555 0102" });
    });
  });

  it("2b. an edit that only reformats a to-do's untouched date is accepted, and the STORED instant is written", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      // 10:14 local on a day three days out: the form posts that day as "YYYY-MM-DD".
      const at = new Date(Date.now() + 3 * DAY);
      const dueAt = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 15, 14)).toISOString();
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(dueAt));
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Measure the yard", dueAt } });
      const r = await acceptSuggestion(deps(a), id, { title: "Measure the yard", dueAt: key });
      expect(r).toMatchObject({ ok: true, status: "accepted" });
      expect((await rowOf(db, a, id)).appliedPayload).toEqual({ title: "Measure the yard", dueAt });
      expect((await tasksTitled(db, a, "Measure the yard")).map((t) => Date.parse(t.due_at as string))).toEqual([Date.parse(dueAt)]);
    });
  });

  it("3. an edited phone \"abc\" is refused on its field, the row stays pending and the contact untouched " +
    "(mutation: skip validateEdit -> FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      expect(await acceptSuggestion(deps(a), id, { value: "abc" }))
        .toEqual({ ok: false, field: "value", error: "That doesn't look like a phone number." });
      expect((await rowOf(db, a, id)).status).toBe("pending");
      expect((await getContact(db, a, k))!.phone).toBeNull();
    });
  });

  it("3b. an edit error with params is put into words in the reader's language, on its field " +
    "(mutation: tr.text without the error's params -> \"{max}\" shows, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "lastName", value: "Garza" } });
      const long = { value: "G".repeat(201) };
      expect(await acceptSuggestion(deps(a), id, long)).toEqual({ ok: false, field: "value", error: "Keep it to 200 characters." });
      expect(await acceptSuggestion(deps(a, { tr: makeTr("es") }), id, long)).toEqual({ ok: false, field: "value", error: "Use 200 caracteres como máximo." });
      expect((await rowOf(db, a, id)).status).toBe("pending");
    });
  });

  it("4. an edit carrying field: \"email\" on a phone suggestion writes the phone, never the email", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      expect(await acceptSuggestion(deps(a), id, { field: "email", value: "956 555 0199" })).toMatchObject({ ok: true, status: "edited" });
      const c = (await getContact(db, a, k))!;
      expect(c.phone).toBe("+19565550199");
      expect(c.email).toBeNull();
    });
  });

  it("5. a field filled since is Out of date and expired/field_filled by system; a first name over \"Caller\" is still fillable " +
    "(mutation: skip stillHolds -> the first answers ok, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2] = [await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId: c1, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      const { error } = await db.from("contacts").update({ phone: "+19565550177" }).eq("id", k);
      expect(error).toBeNull();
      expect(await acceptSuggestion(deps(a), id)).toEqual({ ok: false, error: "Out of date: the phone was filled in since." });
      const row = await rowOf(db, a, id);
      expect([row.status, row.expiredReason, row.decidedBy]).toEqual(["expired", "field_filled", "system"]);

      const caller = await seedContact(db, a, { firstName: "Caller" });
      const first = await seed(db, a, { callId: c2, contactId: caller, kind: "contact_field", payload: { field: "firstName", value: "Maria" } });
      expect(await acceptSuggestion(deps(a), first)).toMatchObject({ ok: true, status: "accepted", toast: "First name saved" });
      expect((await getContact(db, a, caller))!.first_name).toBe("Maria");
    });
  });

  it("6. a last name that does not fit the name on file writes nothing and gives the row back to pending, for an accepted " +
    "AND an edited decision (mutation: revertProposalDecision matches accepted only -> the edited row stays decided, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2] = [await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Roberto" });
      const plain = await seed(db, a, { callId: c1, contactId: k, kind: "contact_field", payload: { field: "lastName", value: "Garza" } });
      const edited = await seed(db, a, { callId: c2, contactId: k, kind: "contact_field", payload: { field: "lastName", value: "Garza" } });
      for (const [id, edit] of [[plain, undefined], [edited, { value: "Garcia" }]] as const) {
        expect(await acceptSuggestion(deps(a), id, edit)).toEqual({ ok: false, error: "Out of date: the name on file doesn't match this caller." });
        const row = await rowOf(db, a, id);
        expect([row.status, row.decidedAt, row.decidedBy, row.appliedPayload, row.appliedRef]).toEqual(["pending", null, null, null, null]);
      }
      expect((await getContact(db, a, k))!.last_name).toBeNull();
    });
  });

  it("6b. a no-write whose give-back meets a fresh pending suggestion for the same call goes out of date (superseded), never " +
    "stays accepted with nothing written (mutation: drop the collision branch -> the row stays accepted, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const k = await seedContact(db, a, { firstName: "Roberto" });
      const id = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "lastName", value: "Garza" } });
      let fresh = "";
      // Just before the give-back (the revert: status pending, no undone_by), a re-delivered webhook makes the same suggestion.
      const writer = intercept(db, "proposals", "update", (v) => v?.status === "pending" && !!v && !("undone_by" in v),
        (values) => realAfter(db, "proposals", values, async () => {
          fresh = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "lastName", value: "Garza" } });
        }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await acceptSuggestion(deps(a, { writer: writer.client }), id))
        .toEqual({ ok: false, error: "Out of date: the name on file doesn't match this caller." });
      expect(writer.stats.fired).toBe(1);
      const row = await rowOf(db, a, id);
      expect([row.status, row.expiredReason, row.decidedBy, row.appliedPayload, row.appliedRef]).toEqual(["expired", "superseded", "system", null, null]);
      expect((await rowOf(db, a, fresh)).status).toBe("pending");
      expect((await getContact(db, a, k))!.last_name).toBeNull();
    });
  });

  it("7. a write that throws is STRANDED: maybe-failed answer, the row left accepted, logged by id (mutation: revert on a throw -> FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      const { client } = intercept(db, "contacts", "update", () => true, rejecting("injected: contacts update failed"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await acceptSuggestion(deps(a, { db: client }), id))
        .toEqual({ ok: false, error: "That may not have gone through. Check before trying again." });
      expect((await rowOf(db, a, id)).status).toBe("accepted");
      expect(errorLines(err).some((l) => l.includes("STRANDED") && l.includes(id))).toBe(true);
    });
  });

  it("8. a deal moved, closed or deleted each has its own out-of-date reason and sentence", async () => {
    await withAccount(async (db, a) => {
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const { pipelineId, ids } = await stagesOf(db, a);
      const cases = [
        ["deal_moved", "Out of date: this deal has moved since.", async (o: string) => moveOpportunityToStage(db, a, o, ids[2]!, "user_test")],
        ["deal_closed", "Out of date: this deal has been closed.", async (o: string) => setOpportunityStatus(db, a, o, "won", "user_test")],
        ["deal_gone", "Out of date: this deal was deleted.", async (o: string) => { const { error } = await db.from("opportunities").delete().eq("id", o); if (error) throw error; }],
      ] as const;
      for (const [reason, sentence, change] of cases) {
        const callId = await seedCall(db, a);
        const { id: opp } = await createOpportunity(db, a, { contactId: k, pipelineId, name: `Deal ${reason}` }, "user_test");
        const id = await seed(db, a, { callId, contactId: k, kind: "opportunity_stage", payload: { opportunityId: opp, fromStageId: ids[0]!, toStageId: ids[1]! } });
        await change(opp);
        expect(await acceptSuggestion(deps(a), id)).toEqual({ ok: false, error: sentence });
        const row = await rowOf(db, a, id);
        expect([row.status, row.expiredReason, row.decidedBy]).toEqual(["expired", reason, "system"]);
      }
    });
  });

  it("9. siblings with the same target are superseded at the Accept's own instant; another field's is untouched " +
    "(mutation: supersede by contact only -> the email one moves, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2, c3] = [await seedCall(db, a), await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const p1 = await seed(db, a, { callId: c1, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      const p2 = await seed(db, a, { callId: c2, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0102" } });
      const mail = await seed(db, a, { callId: c3, contactId: k, kind: "contact_field", payload: { field: "email", value: "rosa@example.invalid" } });
      expect(await acceptSuggestion(deps(a), p1)).toMatchObject({ ok: true });
      const [won, sib, other] = [await rowOf(db, a, p1), await rowOf(db, a, p2), await rowOf(db, a, mail)];
      expect([sib.status, sib.expiredReason, sib.decidedBy]).toEqual(["expired", "superseded", "system"]);
      expect(Date.parse(sib.decidedAt!)).toBe(Date.parse(won.decidedAt!));
      expect((won.appliedRef as { superseded: string[] }).superseded).toEqual([p2]);
      expect(other.status).toBe("pending");
    });
  });

  it("10. past expires_at it is refused on the server and marked expired/aged by system (mutation: drop the age check -> FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Old one", dueAt: null }, expiresAt: new Date(Date.now() - 1000).toISOString() });
      expect(await acceptSuggestion(deps(a), id)).toEqual({ ok: false, error: "Out of date: this suggestion is more than 30 days old." });
      const row = await rowOf(db, a, id);
      expect([row.status, row.expiredReason, row.decidedBy]).toEqual(["expired", "aged", "system"]);
      expect(await tasksTitled(db, a, "Old one")).toEqual([]);
    });
  });

  it("11. P22: a plain Accept of a past-due to-do is refused and the row stays pending; Edit and accept with a new date is edited", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Send the quote", dueAt: dueIn(-3) } });
      expect(await acceptSuggestion(deps(a), id)).toEqual({ ok: false, error: "Its due date has passed. Use Edit and accept to pick a new one." });
      expect((await rowOf(db, a, id)).status).toBe("pending");
      expect(await tasksTitled(db, a, "Send the quote")).toEqual([]);
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 2 * DAY));
      expect(await acceptSuggestion(deps(a), id, { title: "Send the quote", dueAt: key })).toMatchObject({ ok: true, status: "edited" });
      expect(await tasksTitled(db, a, "Send the quote")).toHaveLength(1);
    });
  });

  it("25. a best-effort step after the write fails and the Accept still answers ok: the siblings' expiry, then the applied_ref " +
    "(mutation: no try around the siblings -> the answer is a failure, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2, c3] = [await seedCall(db, a), await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const p1 = await seed(db, a, { callId: c1, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      await seed(db, a, { callId: c2, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0102" } });
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const sibs = intercept(db, "proposals", "update", (v) => v?.expired_reason === "superseded", rejecting("injected: expire failed"));
      expect(await acceptSuggestion(deps(a, { writer: sibs.client }), p1)).toMatchObject({ ok: true, status: "accepted" });
      expect(sibs.stats.fired).toBe(1);
      expect((await getContact(db, a, k))!.phone).toBe("+19565550101");
      expect(await eventsOf(db, a, "contact.updated")).toHaveLength(1);
      expect(errorLines(err).some((l) => l.includes(p1) && l.includes("siblings"))).toBe(true);

      const t = await seed(db, a, { callId: c3, kind: "task", payload: { title: "Book the crew", dueAt: null } });
      const ref = intercept(db, "proposals", "update", (v) => !!v && Object.keys(v).join() === "applied_ref", rejecting("injected: ref failed"));
      expect(await acceptSuggestion(deps(a, { writer: ref.client }), t)).toMatchObject({ ok: true, status: "accepted" });
      expect(ref.stats.fired).toBe(1);
      expect(await tasksTitled(db, a, "Book the crew")).toHaveLength(1);
      expect((await rowOf(db, a, t)).status).toBe("accepted");
      expect(errorLines(err).some((l) => l.includes(t) && l.includes("applied_ref"))).toBe(true);
    });
  });

  it("26. a kind that needs a customer, with none: refused cleanly, the row pending, nothing written " +
    "(mutation: drop the needsContact guard -> apply throws, STRANDED, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, contactId: null, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await acceptSuggestion(deps(a), id)).toEqual({ ok: false, error: "That didn't go through. Try again." });
      expect((await rowOf(db, a, id)).status).toBe("pending");
      expect(await eventsOf(db, a, "contact.updated")).toEqual([]);
    });
  });
});

describe("Discard", () => {
  it("12. Discard keeps the row as dismissed; Discard of an aged row is expired/aged by system with the aged sentence", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2] = [await seedCall(db, a), await seedCall(db, a)];
      const id = await seed(db, a, { callId: c1, kind: "task", payload: { title: "Maybe", dueAt: null } });
      expect(await discardSuggestion(deps(a), id)).toEqual({ ok: true, status: "dismissed", toast: "Discarded", target: { callId: c1, contactId: null } });
      const row = await rowOf(db, a, id);
      expect([row.status, row.decidedBy, row.appliedPayload]).toEqual(["dismissed", ME, null]);
      const old = await seed(db, a, { callId: c2, kind: "task", payload: { title: "Old", dueAt: null }, expiresAt: new Date(Date.now() - 1000).toISOString() });
      expect(await discardSuggestion(deps(a), old)).toEqual({ ok: false, error: "Out of date: this suggestion is more than 30 days old." });
      const aged = await rowOf(db, a, old);
      expect([aged.status, aged.expiredReason, aged.decidedBy]).toEqual(["expired", "aged", "system"]);
    });
  });
});

describe("the loser's answer, and what a reader cannot see", () => {
  it("13. names the person who answered first, or someone on the team, or the out-of-date reason; in Spanish too", async () => {
    await withAccount(async (db, a) => {
      const calls = [await seedCall(db, a), await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const byAna = await seed(db, a, { callId: calls[0]!, kind: "task", payload: { title: "One", dueAt: null } });
      await decideProposal(db, a, byAna, { to: "dismissed", decidedBy: ANA, now: new Date() });
      expect(await acceptSuggestion(deps(a), byAna)).toEqual({ ok: false, error: "Ana López already answered this one." });
      expect(await acceptSuggestion(deps(a, { tr: makeTr("es") }), byAna)).toEqual({ ok: false, error: "Ana López ya respondió esta." });
      expect(await discardSuggestion(deps(a), byAna)).toEqual({ ok: false, error: "Ana López already answered this one." });

      const byNobody = await seed(db, a, { callId: calls[1]!, kind: "task", payload: { title: "Two", dueAt: null } });
      await decideProposal(db, a, byNobody, { to: "dismissed", decidedBy: NAMELESS, now: new Date() });
      expect(await acceptSuggestion(deps(a), byNobody)).toEqual({ ok: false, error: "Someone on the team already answered this one." });

      const bySystem = await seed(db, a, { callId: calls[2]!, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      await decideProposal(db, a, bySystem, { to: "expired", reason: "field_filled", now: new Date() });
      expect(await acceptSuggestion(deps(a), bySystem)).toEqual({ ok: false, error: "Out of date: the phone was filled in since." });
    });
  });

  it("14. an unknown id, and another account's id while that account holds a pending suggestion of its own, are both unavailable " +
    "and nothing moves", async () => {
    await withAccount(async (db, a) => {
      await withAccount(async (_db, b) => {
        const [ca, cb] = [await seedCall(db, a), await seedCall(db, b)];
        const mineA = await seed(db, a, { callId: ca, kind: "task", payload: { title: "A's", dueAt: null } });
        const mineB = await seed(db, b, { callId: cb, kind: "task", payload: { title: "B's", dueAt: null } });
        const unavailable = { ok: false, error: "This suggestion isn't available." };
        expect(await acceptSuggestion(deps(a), "00000000-0000-4000-8000-000000000000")).toEqual(unavailable);
        expect(await acceptSuggestion(deps(b), mineA)).toEqual(unavailable);
        expect(await discardSuggestion(deps(b), mineA)).toEqual(unavailable);
        expect(await undoSuggestion(deps(b), mineA)).toEqual(unavailable);
        expect((await rowOf(db, a, mineA)).status).toBe("pending");
        expect((await rowOf(db, b, mineB)).status).toBe("pending");
        expect(await tasksTitled(db, b, "A's")).toEqual([]);
        expect(await tasksTitled(db, a, "A's")).toEqual([]);
      });
    });
  });
});

describe("the barrier", () => {
  it("15. two Accepts held after their reads and released together make exactly one to-do and one named loser " +
    "(mutations: drop .eq(status, pending) from decideProposal; apply before decideProposal -> 2 tasks, FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Race me", dueAt: null } });
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const afterRead = async () => { arrived++; if (arrived === 2) release(); await gate; };
      const results = await Promise.all([
        acceptSuggestion(deps(a, { afterRead }), id),
        acceptSuggestion(deps(a, { afterRead, userId: ANA }), id),
      ]);
      expect(arrived).toBe(2);
      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      const winner = (await rowOf(db, a, id)).decidedBy;
      expect(losers).toEqual([{ ok: false, error: winner === ANA ? "Ana López already answered this one." : "Someone on the team already answered this one." }]);
      const { count, error } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("account_id", a).eq("title", "Race me");
      expect(error).toBeNull();
      expect(count).toBe(1);
    });
  });
});

describe("Undo", () => {
  it("16a. a to-do: the task deleted with a task.deleted event by the person, the row pending with undone_* stamped", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Undo me", dueAt: dueIn(2) } });
      const now = new Date();
      expect(await acceptSuggestion(deps(a, { now }), id)).toMatchObject({ ok: true });
      const [task] = await tasksTitled(db, a, "Undo me");
      const later = new Date(now.getTime() + 1000);
      expect(await undoSuggestion(deps(a, { now: later }), id)).toEqual({ ok: true, message: "Undone.", target: { callId, contactId: null } });
      expect(await tasksTitled(db, a, "Undo me")).toEqual([]);
      const deleted = await eventsOf(db, a, "task.deleted");
      expect(deleted.map((e) => [e.actor_id, e.payload.taskId])).toEqual([[ME, task!.id]]);
      const row = await rowOf(db, a, id);
      expect([row.status, row.undoneBy, Date.parse(row.undoneAt!)]).toEqual(["pending", ME, later.getTime()]);
      expect([row.decidedAt, row.decidedBy, row.appliedPayload, row.appliedRef]).toEqual([null, null, null, null]);
    });
  });

  it("16b-d. a phone is cleared; a first name filled over \"Caller\" goes back to \"Caller\"; a stage moves back", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2, c3] = [await seedCall(db, a), await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const phone = await seed(db, a, { callId: c1, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      expect(await acceptSuggestion(deps(a), phone)).toMatchObject({ ok: true });
      expect(await undoSuggestion(deps(a), phone)).toMatchObject({ ok: true, message: "Undone." });
      expect((await getContact(db, a, k))!.phone).toBeNull();

      const caller = await seedContact(db, a, { firstName: "Caller" });
      const first = await seed(db, a, { callId: c2, contactId: caller, kind: "contact_field", payload: { field: "firstName", value: "Maria" } });
      expect(await acceptSuggestion(deps(a), first)).toMatchObject({ ok: true });
      expect(await undoSuggestion(deps(a), first)).toMatchObject({ ok: true, message: "Undone." });
      expect((await getContact(db, a, caller))!.first_name).toBe("Caller");

      const { pipelineId, ids } = await stagesOf(db, a);
      const { id: opp } = await createOpportunity(db, a, { contactId: k, pipelineId, name: "Deal" }, "user_test");
      const stage = await seed(db, a, { callId: c3, contactId: k, kind: "opportunity_stage", payload: { opportunityId: opp, fromStageId: ids[0]!, toStageId: ids[1]! } });
      expect(await acceptSuggestion(deps(a), stage)).toMatchObject({ ok: true, toast: "Moved to Contacted" });
      expect(await undoSuggestion(deps(a), stage)).toMatchObject({ ok: true, message: "Undone." });
      const { data } = await db.from("opportunities").select("stage_id").eq("id", opp).single();
      expect(data!.stage_id).toBe(ids[0]);
    });
  });

  it("17. refused after 2 minutes and by another person, the row still decided " +
    "(mutation: window Infinity, or drop the decider check -> FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Keep me", dueAt: null } });
      const now = new Date();
      expect(await acceptSuggestion(deps(a, { now }), id)).toMatchObject({ ok: true });
      const tooLate = { ok: false, error: "Too late to undo here. Change it by hand." };
      expect(await undoSuggestion(deps(a, { now: new Date(now.getTime() + 120_001) }), id)).toEqual(tooLate);
      expect(await undoSuggestion(deps(a, { now: new Date(now.getTime() + 1000), userId: ANA }), id)).toEqual(tooLate);
      expect((await rowOf(db, a, id)).status).toBe("accepted");
      expect(await tasksTitled(db, a, "Keep me")).toHaveLength(1);
    });
  });

  it("17b. a row with no applied_ref (copied from the old table, or an old-code Accept) is too late, up front", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Old code", dueAt: null } });
      await decideProposal(db, a, id, { to: "accepted", decidedBy: ME, appliedPayload: { title: "Old code", dueAt: null }, now: new Date() });
      const { data: task } = await db.from("tasks").insert({ account_id: a, title: "Old code" }).select("id").single();
      const del = intercept(db, "tasks", "delete", () => false, () => null);
      expect(await undoSuggestion(deps(a, { db: del.client }), id)).toEqual({ ok: false, error: "Too late to undo here. Change it by hand." });
      expect(del.stats.calls).toBe(0);
      expect((await rowOf(db, a, id)).status).toBe("accepted");
      expect((await tasksTitled(db, a, "Old code")).map((t) => t.id)).toEqual([task!.id]);
    });
  });

  it("18. the record changed since (to-do retitled, to-do completed, field edited, deal moved): changed, nothing written, the row " +
    "still decided (mutations: status CAS before the inverse; skip deleteTaskForUndo's still-as-left check -> FAILS)", async () => {
    await withAccount(async (db, a) => {
      const changed = { ok: false, error: "It has changed since. Change it by hand." };
      const calls = [await seedCall(db, a), await seedCall(db, a), await seedCall(db, a), await seedCall(db, a)];

      const retitled = await seed(db, a, { callId: calls[0]!, kind: "task", payload: { title: "Retitle me", dueAt: null } });
      expect(await acceptSuggestion(deps(a), retitled)).toMatchObject({ ok: true });
      await db.from("tasks").update({ title: "Retitled by hand" }).eq("account_id", a).eq("title", "Retitle me");
      expect(await undoSuggestion(deps(a), retitled)).toEqual(changed);
      expect(await tasksTitled(db, a, "Retitled by hand")).toHaveLength(1);
      expect((await rowOf(db, a, retitled)).status).toBe("accepted");

      const done = await seed(db, a, { callId: calls[1]!, kind: "task", payload: { title: "Complete me", dueAt: null } });
      expect(await acceptSuggestion(deps(a), done)).toMatchObject({ ok: true });
      await db.from("tasks").update({ completed_at: new Date().toISOString() }).eq("account_id", a).eq("title", "Complete me");
      expect(await undoSuggestion(deps(a), done)).toEqual(changed);
      expect(await tasksTitled(db, a, "Complete me")).toHaveLength(1);
      expect((await rowOf(db, a, done)).status).toBe("accepted");

      const k = await seedContact(db, a, { firstName: "Rosa" });
      const field = await seed(db, a, { callId: calls[2]!, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      expect(await acceptSuggestion(deps(a), field)).toMatchObject({ ok: true });
      await db.from("contacts").update({ phone: "+19565550177" }).eq("id", k);
      expect(await undoSuggestion(deps(a), field)).toEqual(changed);
      expect((await getContact(db, a, k))!.phone).toBe("+19565550177");
      expect((await rowOf(db, a, field)).status).toBe("accepted");

      const { pipelineId, ids } = await stagesOf(db, a);
      const { id: opp } = await createOpportunity(db, a, { contactId: k, pipelineId, name: "Deal" }, "user_test");
      const stage = await seed(db, a, { callId: calls[3]!, contactId: k, kind: "opportunity_stage", payload: { opportunityId: opp, fromStageId: ids[0]!, toStageId: ids[1]! } });
      expect(await acceptSuggestion(deps(a), stage)).toMatchObject({ ok: true });
      await moveOpportunityToStage(db, a, opp, ids[2]!, "user_test");
      expect(await undoSuggestion(deps(a), stage)).toEqual(changed);
      const { data } = await db.from("opportunities").select("stage_id").eq("id", opp).single();
      expect(data!.stage_id).toBe(ids[2]);
      expect((await rowOf(db, a, stage)).status).toBe("accepted");
    });
  });

  it("19. an inverse that throws is STRANDED: maybe-failed, the row still decided, logged by id", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Throw on delete", dueAt: null } });
      expect(await acceptSuggestion(deps(a), id)).toMatchObject({ ok: true });
      const { client } = intercept(db, "tasks", "delete", () => true, rejecting("injected: tasks delete failed"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await undoSuggestion(deps(a, { db: client }), id)).toEqual({ ok: false, error: "That may not have gone through. Check before trying again." });
      expect((await rowOf(db, a, id)).status).toBe("accepted");
      expect(errorLines(err).some((l) => l.includes("STRANDED") && l.includes(id))).toBe(true);
    });
  });

  it("20. an inverse that succeeded but whose compare-and-swap matched nothing: the undo-stranded answer, logged, never retried", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Half undone", dueAt: null } });
      expect(await acceptSuggestion(deps(a), id)).toMatchObject({ ok: true });
      const writer = intercept(db, "proposals", "update", (v) => v?.status === "pending" && !!v && "undone_by" in v, matchingNothing);
      const req = intercept(db, "tasks", "delete", () => false, () => null);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await undoSuggestion(deps(a, { db: req.client, writer: writer.client }), id))
        .toEqual({ ok: false, error: "The change was undone, but this suggestion didn't update. Refresh before doing anything else." });
      expect(writer.stats.fired).toBe(1);
      expect(req.stats.calls).toBe(1);
      expect(await tasksTitled(db, a, "Half undone")).toEqual([]);
      expect((await rowOf(db, a, id)).status).toBe("accepted");
      expect(errorLines(err).some((l) => l.includes(id) && l.includes("inverse done, status not moved"))).toBe(true);
    });
  });

  it("20b. a stale Undo whose row was decided again since (a later decided_at) does not move the newer decision " +
    "(T4 review minor 4; mutation: drop the decided_at scope from the compare-and-swap -> Undone., FAILS)", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Decided twice", dueAt: null } });
      const now = new Date();
      expect(await acceptSuggestion(deps(a, { now }), id)).toMatchObject({ ok: true });
      // Between this Undo's read and its compare-and-swap, the row is decided again (an Undo and a fresh Accept by the
      // same person): same status, same decider, a later instant. Then the REAL compare-and-swap runs, with its filters.
      const again = new Date(now.getTime() + 5000).toISOString();
      const writer = intercept(db, "proposals", "update", (v) => v?.status === "pending" && !!v && "undone_by" in v,
        (values) => realAfter(db, "proposals", values, async () => {
          const { error } = await db.from("proposals").update({ decided_at: again }).eq("id", id);
          if (error) throw new Error(error.message);
        }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const undo = await undoSuggestion(deps(a, { now: new Date(now.getTime() + 1000), writer: writer.client }), id);
      expect(undo).toEqual({ ok: false, error: "The change was undone, but this suggestion didn't update. Refresh before doing anything else." });
      const row = await rowOf(db, a, id);
      expect([row.status, row.decidedAt && Date.parse(row.decidedAt)]).toEqual(["accepted", Date.parse(again)]);
    });
  });

  it("21. Undo gives back the siblings this Accept superseded; one that moved since stays; one whose call has a new pending row " +
    "stays expired/superseded and is logged (mutation: skip restoreSiblings -> FAILS)", async () => {
    await withAccount(async (db, a) => {
      const calls = [await seedCall(db, a), await seedCall(db, a), await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const ph = (callId: string, value: string) => seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "phone", value } });
      const p = await ph(calls[0]!, "956 555 0101");
      const back = await ph(calls[1]!, "956 555 0102");
      const moved = await ph(calls[2]!, "956 555 0103");
      const collided = await ph(calls[3]!, "956 555 0104");
      expect(await acceptSuggestion(deps(a), p)).toMatchObject({ ok: true });
      expect(((await rowOf(db, a, p)).appliedRef as { superseded: string[] }).superseded.sort()).toEqual([back, moved, collided].sort());
      await db.from("proposals").update({ status: "dismissed", expired_reason: null, decided_by: ANA, decided_at: new Date().toISOString() }).eq("id", moved);
      const fresh = await ph(calls[3]!, "956 555 0105");
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await undoSuggestion(deps(a), p)).toMatchObject({ ok: true, message: "Undone." });
      expect((await rowOf(db, a, back)).status).toBe("pending");
      expect((await rowOf(db, a, moved)).status).toBe("dismissed");
      const c = await rowOf(db, a, collided);
      expect([c.status, c.expiredReason]).toEqual(["expired", "superseded"]);
      expect((await rowOf(db, a, fresh)).status).toBe("pending");
      expect(errorLines(err).some((l) => l.includes(collided))).toBe(true);
    });
  });

  it("21b. a restore that throws leaves the Undo answered ok (best-effort; live case 25's Undo variant)", async () => {
    await withAccount(async (db, a) => {
      const [c1, c2] = [await seedCall(db, a), await seedCall(db, a)];
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const p = await seed(db, a, { callId: c1, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      const sib = await seed(db, a, { callId: c2, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0102" } });
      expect(await acceptSuggestion(deps(a), p)).toMatchObject({ ok: true });
      const writer = intercept(db, "proposals", "update", (v) => v?.status === "pending" && !!v && !("undone_by" in v), rejecting("injected: restore failed"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await undoSuggestion(deps(a, { writer: writer.client }), p)).toMatchObject({ ok: true, message: "Undone." });
      expect(writer.stats.fired).toBe(1);
      expect((await rowOf(db, a, p)).status).toBe("pending");
      expect((await rowOf(db, a, sib)).status).toBe("expired");
      expect(errorLines(err).some((l) => l.includes(p) && l.includes("siblings"))).toBe(true);
    });
  });

  it("22. the one-pending index meets the row itself: the inverse runs, the row goes expired/superseded, Undone.", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const k = await seedContact(db, a, { firstName: "Rosa" });
      const id = await seed(db, a, { callId, contactId: k, kind: "task", payload: { title: "Twice told", dueAt: null } });
      expect(await acceptSuggestion(deps(a), id)).toMatchObject({ ok: true });
      await seed(db, a, { callId, contactId: k, kind: "task", payload: { title: "Twice told", dueAt: null } });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await undoSuggestion(deps(a), id)).toMatchObject({ ok: true, message: "Undone." });
      expect(await tasksTitled(db, a, "Twice told")).toEqual([]);
      const row = await rowOf(db, a, id);
      expect([row.status, row.expiredReason, row.decidedBy]).toEqual(["expired", "superseded", "system"]);
    });
  });

  it("23. Undo after Discard: pending, decided_* cleared, undone_* stamped", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const id = await seed(db, a, { callId, kind: "task", payload: { title: "Not now", dueAt: null } });
      expect(await discardSuggestion(deps(a), id)).toMatchObject({ ok: true });
      expect(await undoSuggestion(deps(a), id)).toMatchObject({ ok: true, message: "Undone." });
      const row = await rowOf(db, a, id);
      expect([row.status, row.decidedAt, row.decidedBy, row.undoneBy]).toEqual(["pending", null, null, ME]);
      expect(await tasksTitled(db, a, "Not now")).toEqual([]);
    });
  });

  it("24. Undo of a fill that raised a duplicate flag says the flag is still in Duplicates, and it is", async () => {
    await withAccount(async (db, a) => {
      const callId = await seedCall(db, a);
      const twin = await seedContact(db, a, { firstName: "Rosa", phone: "+19565550101" });
      const k = await seedContact(db, a, { firstName: "Rose" });
      const id = await seed(db, a, { callId, contactId: k, kind: "contact_field", payload: { field: "phone", value: "956 555 0101" } });
      expect(await acceptSuggestion(deps(a), id)).toMatchObject({ ok: true });
      expect(await undoSuggestion(deps(a), id)).toMatchObject({ ok: true, message: "Undone. The possible duplicate it found is still in Duplicates." });
      const { data, error } = await db.from("contact_duplicate_flags").select("contact_a, contact_b").eq("account_id", a);
      expect(error).toBeNull();
      expect((data ?? []).map((f) => [f.contact_a, f.contact_b].sort())).toEqual([[twin, k].sort()]);
    });
  });
});
