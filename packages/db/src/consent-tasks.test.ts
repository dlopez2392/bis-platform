import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./events", () => ({ emit: vi.fn(async () => undefined) }));
import { emit } from "./events";
// The two ledger reads the hold guard makes; the reducer (newestDecidingRow) stays real.
vi.mock("./consent", async (importOriginal) => ({
  ...(await importOriginal<object>()), readConsentEvent: vi.fn(), readConsentHistory: vi.fn(),
}));
import { readConsentEvent, readConsentHistory } from "./consent";
import {
  ensureConsentTask, completeTasksForConsentEvents, reopenTasks, completeTask, holdOpenTaskIds, HoldUndecidedError,
  readTaskContact,
} from "./activities";
import { nextBookedStart } from "./booking";

/**
 * The consent To-do helpers, against a PostgREST-shaped fake that records
 * what it was asked (no database). The live behaviour — the unique index, the
 * composite key — is consent-tasks-live.test.ts (CI) and Task 1's schema test.
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(answers: Answer[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  let next = 0;
  const answer = () => Promise.resolve(answers[next++] ?? { data: null, error: null });
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["insert", "update", "eq", "in", "is", "gt", "order", "select"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  chain.single = () => { calls.push(["single"]); return answer(); };
  chain.maybeSingle = () => { calls.push(["maybeSingle"]); return answer(); };
  chain.limit = (...a: unknown[]) => { calls.push(["limit", ...a]); return answer(); };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

describe("ensureConsentTask — one To-do per ledger row", () => {
  it("inserts the task with its consent_event_id and emits task.created (mutation: drop consent_event_id from the insert → FAILS)", async () => {
    vi.mocked(emit).mockClear();
    const f = fakeDb([{ data: { id: "t1" }, error: null }]);
    expect(await ensureConsentTask(f.db, "a1", { contactId: "c1", consentEventId: "e1", title: "Ana may have asked …" }, "sms-inbound", "system"))
      .toEqual({ id: "t1", created: true });
    expect(f.calls.find((c) => c[0] === "insert")?.[1]).toEqual({
      account_id: "a1", contact_id: "c1", title: "Ana may have asked …", consent_event_id: "e1",
    });
    expect(emit).toHaveBeenCalledWith(f.db, "a1", "task.created", "sms-inbound", { taskId: "t1", contactId: "c1", consentEventId: "e1" }, "system");
  });

  it("a second attempt for the same row (23505 on tasks_consent_event_once) returns the FIRST task and emits nothing (mutation: throw on 23505 → FAILS)", async () => {
    vi.mocked(emit).mockClear();
    const f = fakeDb([{ data: null, error: { code: "23505", message: "duplicate" } }, { data: { id: "t0" }, error: null }]);
    expect(await ensureConsentTask(f.db, "a1", { contactId: "c1", consentEventId: "e1", title: "x" }, "sms-inbound", "system"))
      .toEqual({ id: "t0", created: false });
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"], ["eq", "consent_event_id", "e1"]]));
    expect(emit).not.toHaveBeenCalled();
  });

  it("any other insert error THROWS, so the inbound route answers 503 and Telnyx retries (mutation: swallow every error → FAILS)", async () => {
    const f = fakeDb([{ data: null, error: { code: "42501", message: "permission denied" } }]);
    await expect(ensureConsentTask(f.db, "a1", { contactId: "c1", consentEventId: "e1", title: "x" }, "a", "system")).rejects.toThrow("permission denied");
  });
});

describe("completeTasksForConsentEvents / reopenTasks — the hold To-do follows the hold", () => {
  it("completes only OPEN tasks linking these rows, and returns exactly the ids it completed (mutation: drop .is('completed_at', null) → a done task would be re-stamped and reopened by the undo, FAILS)", async () => {
    const f = fakeDb([{ data: [{ id: "t1" }, { id: "t2" }], error: null }]);
    expect(await completeTasksForConsentEvents(f.db, "a1", ["e1", "e2"], "user_1")).toEqual(["t1", "t2"]);
    expect(f.calls).toEqual(expect.arrayContaining([
      ["eq", "account_id", "a1"], ["in", "consent_event_id", ["e1", "e2"]], ["is", "completed_at", null], ["select", "id"],
    ]));
  });

  it("no rows asked about is no write at all (mutation: drop the empty-list guard → an unfiltered update is issued, FAILS)", async () => {
    const f = fakeDb([]);
    expect(await completeTasksForConsentEvents(f.db, "a1", [], "user_1")).toEqual([]);
    await reopenTasks(f.db, "a1", [], "user_1");
    expect(f.calls).toEqual([]);
  });

  it("reopens exactly the tasks the undo carries, in this account (mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb([{ data: [{ id: "t1" }], error: null }]);
    await reopenTasks(f.db, "a1", ["t1"], "user_1");
    expect(f.calls).toEqual(expect.arrayContaining([["update", { completed_at: null }], ["eq", "account_id", "a1"], ["in", "id", ["t1"]]]));
  });
});

describe("nextBookedStart — for the CANCEL To-do", () => {
  it("the soonest BOOKED appointment after now, for this contact (mutation: drop the status filter → a cancelled one would count, FAILS)", async () => {
    const f = fakeDb([{ data: [{ starts_at: "2026-10-09T15:00:00Z" }], error: null }]);
    expect(await nextBookedStart(f.db, "a1", "c1", "2026-10-06T00:00:00Z")).toBe("2026-10-09T15:00:00Z");
    expect(f.calls).toEqual(expect.arrayContaining([
      ["eq", "account_id", "a1"], ["eq", "contact_id", "c1"], ["eq", "status", "booked"], ["gt", "starts_at", "2026-10-06T00:00:00Z"],
      ["order", "starts_at", { ascending: true }], ["limit", 1],
    ]));
  });

  it("none is null, and a read error throws (mutation: return null on error → FAILS)", async () => {
    expect(await nextBookedStart(fakeDb([{ data: [], error: null }]).db, "a1", "c1", "2026-10-06T00:00:00Z")).toBeNull();
    await expect(nextBookedStart(fakeDb([{ data: null, error: { message: "boom" } }]).db, "a1", "c1", "x")).rejects.toThrow("boom");
  });
});

/** A hold on the contact's number, as readConsentEvent answers it. */
const HOLD = { id: "h1", action: "held", method: "free_text", channel: "sms", address: "+19562921696", contact_id: "c1",
  occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null };

describe("completeTask — a hold's To-do closes by deciding the hold, never by Done (review R3-I1, R3-N3; G21)", () => {
  beforeEach(() => {
    vi.mocked(readConsentEvent).mockReset().mockResolvedValue(HOLD as never);
    vi.mocked(readConsentHistory).mockReset();
  });

  it("refuses while the NUMBER is still on hold — its newest deciding row a hold, the To-do's own or a later one — and writes nothing (mutation: drop the guard → the update runs, FAILS; mutation: ask only whether the To-do's OWN hold is newest → the H2 case completes, FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([HOLD] as never);
    const f = fakeDb([{ data: { consent_event_id: "h1" }, error: null }]);
    await expect(completeTask(f.db, "a1", "t1", "user_1")).rejects.toBeInstanceOf(HoldUndecidedError);
    expect(f.calls.some((c) => c[0] === "update")).toBe(false);
    // The guard's own read is scoped to THIS account — the only db call this
    // path makes before throwing (mutation: drop .eq("account_id", …) on the
    // guard read → this list no longer contains it, FAILS).
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"]]));
    // The ledger reads the guard makes are scoped to THIS account too
    // (mutation: pass a different/blank accountId into either read → FAILS).
    expect(readConsentEvent).toHaveBeenCalledWith(f.db, "a1", "h1");
    expect(readConsentHistory).toHaveBeenCalledWith(f.db, "a1", "sms", "+19562921696");
    // Not a stop, then its Undo: a NEW hold (H2) is newest, and the reopened To-do T1 still links H1.
    vi.mocked(readConsentHistory).mockResolvedValue([
      { ...HOLD, id: "h2", method: "staff_undo", occurred_at: "2026-10-05T12:00:00Z" },
      { ...HOLD, id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z" }, HOLD,
    ] as never);
    const g = fakeDb([{ data: { consent_event_id: "h1" }, error: null }]);
    await expect(completeTask(g.db, "a1", "t1", "user_1")).rejects.toBeInstanceOf(HoldUndecidedError);
  });

  it("a failed read of the To-do's own consent link fails CLOSED — no update issued (mutation: delete `if (readError) throw …` → FAILS)", async () => {
    const f = fakeDb([{ data: null, error: { message: "boom" } }]);
    await expect(completeTask(f.db, "a1", "t1", "user_1")).rejects.toThrow("boom");
    expect(f.calls.some((c) => c[0] === "update")).toBe(false);
  });

  it("only a HOLD refuses — a CANCEL To-do (linking a revoked row) still completes even while the number's ledger separately shows a hold as newest (mutation: reduce the check to `if (!ev) return false` → FAILS)", async () => {
    vi.mocked(readConsentEvent).mockResolvedValue({ ...HOLD, id: "r0", action: "revoked", method: "keyword" } as never);
    vi.mocked(readConsentHistory).mockResolvedValue([{ ...HOLD, id: "h9" }] as never); // a hold, newest
    const f = fakeDb([{ data: { consent_event_id: "r0" }, error: null }, { data: null, error: null }]);
    await completeTask(f.db, "a1", "t9", "user_1");
    expect(f.calls.some((c) => c[0] === "update")).toBe(true);
  });

  it("completes once the hold is decided, and a task with no consent link exactly as before (mutation: refuse every linked task → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { ...HOLD, id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z" }, HOLD,
    ] as never);
    const f = fakeDb([{ data: { consent_event_id: "h1" }, error: null }, { data: null, error: null }]);
    await completeTask(f.db, "a1", "t1", "user_1");
    expect(f.calls.some((c) => c[0] === "update")).toBe(true);
    const g = fakeDb([{ data: { consent_event_id: null }, error: null }, { data: null, error: null }]);
    await completeTask(g.db, "a1", "t2", "user_1");
    expect(g.calls.some((c) => c[0] === "update")).toBe(true);
    expect(readConsentEvent).toHaveBeenCalledTimes(1);   // the plain task read no ledger
  });
});

describe("holdOpenTaskIds — the open To-dos the contact timeline shows a hint for, in place of a Done that would be refused (review R3-N1)", () => {
  beforeEach(() => {
    vi.mocked(readConsentEvent).mockReset().mockResolvedValue(HOLD as never);
    vi.mocked(readConsentHistory).mockReset().mockResolvedValue([HOLD] as never);
  });

  it("only OPEN tasks linked to a number that is still on hold (mutation: drop the open-task condition → the done one is listed, FAILS)", async () => {
    expect(await holdOpenTaskIds({} as never, "a1", [
      { id: "t_open", completed_at: null, consent_event_id: "h1" },
      { id: "t_done", completed_at: "2026-10-05T12:00:00Z", consent_event_id: "h1" },
      { id: "t_plain", completed_at: null, consent_event_id: null },
    ])).toEqual(["t_open"]);
  });

  it("a number no longer on hold offers Done again (mutation: hint for every linked task → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { ...HOLD, id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z" }, HOLD,
    ] as never);
    expect(await holdOpenTaskIds({} as never, "a1", [{ id: "t_open", completed_at: null, consent_event_id: "h1" }])).toEqual([]);
  });
});

describe("readTaskContact — the To-do's contact and the ledger row it asks about", () => {
  it("reads the task by account AND id (mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb([{ data: { contact_id: "c1", consent_event_id: "h1" }, error: null }]);
    expect(await readTaskContact(f.db, "a1", "t1")).toEqual({ contactId: "c1", consentEventId: "h1" });
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"], ["eq", "id", "t1"]]));
    expect(await readTaskContact(fakeDb([{ data: null, error: null }]).db, "a1", "t1")).toBeNull();
  });
});
