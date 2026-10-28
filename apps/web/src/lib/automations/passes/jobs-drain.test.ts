import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-196 Task 8 — the jobs drain (spec section 9). Every finisher is fenced by
 * the claim token; a throw retries on backoff.ts's curve (or dies at the
 * ROW's max_attempts, or at once on PermanentJobError); a payload that cannot
 * parse dies with fixed text; the drain never claims more than its budget
 * fits; and after the loop it sweeps, then writes `jobs.dead` and
 * `jobs.backlog`.
 */
const db = vi.hoisted(() => ({
  claimJob: vi.fn(),
  completeJob: vi.fn(),
  retryJob: vi.fn(),
  killJob: vi.fn(),
  sweepJobs: vi.fn(),
  deadJobCounts: vi.fn(),
  oldestDueJob: vi.fn(),
  recordHeartbeat: vi.fn(),
  DEAD_JOB_COUNT_CAP: 1000,
}));
vi.mock("@bis/db", () => db);

import {
  makeJobsDrainPass, jobsDrainPass, JOBS_DRAIN_BUDGET_MS, JOBS_PER_DRAIN, JOBS_SWEEP_LIMIT,
  JOBS_BACKLOG_ALERT_MS, JOBS_DEAD_KEY, JOBS_BACKLOG_KEY,
} from "./jobs-drain";
import { PermanentJobError, RetryJobAfter, type JobContext, type JobHandler } from "../jobs/types";
import type { PassContext } from "../context";
import type { JobRow } from "@bis/db";

const T0 = Date.parse("2026-10-28T14:00:00.000Z");
const MIN = 60_000;
const TICK_NOW = new Date(T0 - 2 * MIN);
const ctxDb = { tag: "tick-db" };
const ctx = { db: ctxDb, now: TICK_NOW } as unknown as PassContext;

let seq = 0;
function row(over: Partial<JobRow> = {}): JobRow {
  seq += 1;
  return {
    id: `job-${seq}`, kind: "test.job", account_id: "acc-1", idempotency_key: `k-${seq}`, payload: { n: seq },
    state: "running", run_after: new Date(T0).toISOString(), attempts: 1, max_attempts: 3, timeout_ms: 5_000,
    claim_token: `tok-${seq}`, lease_until: null, last_error: null,
    created_at: new Date(T0).toISOString(), updated_at: new Date(T0).toISOString(), finished_at: null,
    ...over,
  };
}

function handler(run: (c: JobContext, p: unknown) => Promise<void>, over: Partial<JobHandler<unknown>> = {}): JobHandler<unknown> {
  return { kind: "test.job", maxAttempts: 3, timeoutMs: 5_000, parse: (p) => p, run: vi.fn(run), ...over };
}

/** One job, then an empty queue. */
function queue(...jobs: JobRow[]) {
  db.claimJob.mockReset();
  for (const j of jobs) db.claimJob.mockResolvedValueOnce(j);
  db.claimJob.mockResolvedValue(null);
}

const beat = vi.fn();
function drain(h: JobHandler<unknown>, clock: () => number = () => T0) {
  return makeJobsDrainPass({ handlers: { "test.job": h }, clock, random: () => 0.5, beat });
}
const beatsFor = (key: string) => beat.mock.calls.filter((c) => c[1] === key).map((c) => c[2]);

beforeEach(() => {
  seq = 0;
  queue();
  db.completeJob.mockReset().mockResolvedValue(true);
  db.retryJob.mockReset().mockResolvedValue(true);
  db.killJob.mockReset().mockResolvedValue(true);
  db.sweepJobs.mockReset().mockResolvedValue(0);
  db.deadJobCounts.mockReset().mockResolvedValue({ counts: {}, truncated: false });
  db.oldestDueJob.mockReset().mockResolvedValue(null);
  db.recordHeartbeat.mockReset().mockResolvedValue(undefined);
  beat.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("jobsDrainPass — the drain (spec section 9)", () => {
  it("is the registry-shaped pass keyed jobsDrain, and its constants are the plan's", () => {
    expect(jobsDrainPass.key).toBe("jobsDrain");
    expect(makeJobsDrainPass().key).toBe("jobsDrain");
    expect([JOBS_DRAIN_BUDGET_MS, JOBS_PER_DRAIN, JOBS_SWEEP_LIMIT, JOBS_BACKLOG_ALERT_MS]).toEqual([200_000, 100, 500, 60 * MIN]);
    expect([JOBS_DEAD_KEY, JOBS_BACKLOG_KEY]).toEqual(["jobs.dead", "jobs.backlog"]);
  });

  it("1. success completes the job under its fence, and the handler sees the tick's now and the row's attempt, max and account (mutation: skip completeJob → FAILS)", async () => {
    const job = row({ attempts: 2, max_attempts: 4, account_id: "acc-9" });
    queue(job);
    let seen: JobContext | undefined;
    const h = handler(async (c) => { seen = c; });
    const counters = await drain(h).run(ctx);
    expect(db.completeJob).toHaveBeenCalledWith(ctxDb, { id: job.id, claimToken: job.claim_token }, new Date(T0).toISOString());
    expect(counters).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, dead: 0, vanished: 0, notStartedBudget: 0 });
    expect(seen!.now).toBe(TICK_NOW);
    expect(seen!.db).toBe(ctxDb);
    expect(seen!.job).toMatchObject({ id: job.id, kind: "test.job", attempt: 2, maxAttempts: 4, accountId: "acc-9" });
    expect(seen!.job.signal).toBeInstanceOf(AbortSignal);
    expect(h.run).toHaveBeenCalledWith(expect.anything(), job.payload);
  });

  it("2. a throw on attempt 1 of 3 retries under the fence 15 minutes out (random 0.5 = no jitter) with the error's message (mutation: attempt + 1 → +30 min, FAILS)", async () => {
    const job = row({ attempts: 1, max_attempts: 3 });
    queue(job);
    const counters = await drain(handler(async () => { throw new Error("calendar said 500"); })).run(ctx);
    expect(db.retryJob).toHaveBeenCalledWith(
      ctxDb, { id: job.id, claimToken: job.claim_token }, new Date(T0 + 15 * MIN).toISOString(), "calendar said 500", new Date(T0).toISOString(),
    );
    expect(db.killJob).not.toHaveBeenCalled();
    expect(db.completeJob).not.toHaveBeenCalled();
    expect(counters).toMatchObject({ claimed: 1, succeeded: 0, retried: 1, dead: 0 });
  });

  it("3. a throw on attempt 3 of 3 (the ROW's max) is dead-lettered, never retried (mutation: > for >= → retry, FAILS)", async () => {
    const job = row({ attempts: 3, max_attempts: 3 });
    queue(job);
    // The handler's own maxAttempts says 25: the row's copy, made at enqueue, is what binds.
    const counters = await drain(handler(async () => { throw new Error("still down"); }, { maxAttempts: 25 })).run(ctx);
    expect(db.killJob).toHaveBeenCalledWith(ctxDb, { id: job.id, claimToken: job.claim_token }, "still down", new Date(T0).toISOString());
    expect(db.retryJob).not.toHaveBeenCalled();
    expect(counters).toMatchObject({ retried: 0, dead: 1 });
  });

  it("4. PermanentJobError on attempt 1 is dead at once (mutation: drop the instanceof → retry, FAILS)", async () => {
    queue(row({ attempts: 1, max_attempts: 5 }));
    const counters = await drain(handler(async () => { throw new PermanentJobError("the calendar was deleted"); })).run(ctx);
    expect(db.killJob).toHaveBeenCalledWith(ctxDb, expect.anything(), "the calendar was deleted", expect.any(String));
    expect(db.retryJob).not.toHaveBeenCalled();
    expect(counters).toMatchObject({ dead: 1, retried: 0 });
  });

  it("5. RetryJobAfter(5 min) retries 5 minutes out, not on the default curve (mutation: ignore afterMs → +15 min, FAILS)", async () => {
    queue(row({ attempts: 1, max_attempts: 3 }));
    await drain(handler(async () => { throw new RetryJobAfter(5 * MIN, "rate limited"); })).run(ctx);
    expect(db.retryJob).toHaveBeenCalledWith(ctxDb, expect.anything(), new Date(T0 + 5 * MIN).toISOString(), "rate limited", expect.any(String));
  });

  it.each([
    ["NaN", Number.NaN],
    ["a negative wait", -5 * MIN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("5a. a RetryJobAfter of %s is not a wait: the retry falls back to the curve, 15 minutes out (mutation: use afterMs unchecked → FAILS)", async (_label, afterMs) => {
    queue(row({ attempts: 1, max_attempts: 3 }));
    await drain(handler(async () => { throw new RetryJobAfter(afterMs, "odd header"); })).run(ctx);
    expect(db.retryJob).toHaveBeenCalledWith(ctxDb, expect.anything(), new Date(T0 + 15 * MIN).toISOString(), "odd header", expect.any(String));
  });

  it("5b. a handler's own backoff is the curve a retry follows", async () => {
    queue(row({ attempts: 2, max_attempts: 3 }));
    await drain(handler(async () => { throw new Error("x"); }, { backoff: { baseMs: MIN, capMs: 60 * MIN } })).run(ctx);
    expect(db.retryJob).toHaveBeenCalledWith(ctxDb, expect.anything(), new Date(T0 + 2 * MIN).toISOString(), "x", expect.any(String));
  });

  it("6. a payload that cannot parse is dead with FIXED text that never quotes the payload, and run is never called (mutation: pass the parse error's message → FAILS)", async () => {
    const job = row({ payload: { secret: "MARKER-4417" } });
    queue(job);
    const h = handler(async () => {}, { parse: (p) => { throw new Error(`bad payload ${JSON.stringify(p)}`); } });
    const counters = await drain(h).run(ctx);
    expect(db.killJob).toHaveBeenCalledWith(ctxDb, { id: job.id, claimToken: job.claim_token }, "the job's payload could not be read", expect.any(String));
    expect(JSON.stringify(db.killJob.mock.calls)).not.toContain("MARKER-4417");
    expect(h.run).not.toHaveBeenCalled();
    expect(counters).toMatchObject({ claimed: 1, dead: 1 });
  });

  it("7. a finisher that finds its fence gone counts vanished, never succeeded (mutation: count success regardless → FAILS)", async () => {
    queue(row());
    db.completeJob.mockResolvedValue(false);
    expect(await drain(handler(async () => {})).run(ctx)).toMatchObject({ claimed: 1, succeeded: 0, vanished: 1 });
  });

  it("7b. a lost fence on a retry or a kill is vanished too", async () => {
    queue(row({ attempts: 1 }), row({ attempts: 3, max_attempts: 3 }));
    db.retryJob.mockResolvedValue(false);
    db.killJob.mockResolvedValue(false);
    expect(await drain(handler(async () => { throw new Error("x"); })).run(ctx)).toMatchObject({ claimed: 2, retried: 0, dead: 0, vanished: 2 });
  });

  it("7c. a non-Error throw is recorded as its string", async () => {
    queue(row({ attempts: 1 }));
    await drain(handler(async () => { throw "plain words"; })).run(ctx);
    expect(db.retryJob).toHaveBeenCalledWith(ctxDb, expect.anything(), expect.any(String), "plain words", expect.any(String));
  });

  it("8. a handler that never settles is cut at the ROW's timeout: retried with the timeout text, and its signal is aborted (mutation: drop the race → the drain never settles, FAILS)", async () => {
    vi.useFakeTimers();
    queue(row({ timeout_ms: 1_000, attempts: 1, max_attempts: 3 }));
    let signal: AbortSignal | undefined;
    const h = handler((c) => { signal = c.job.signal; return new Promise<void>(() => {}); }, { timeoutMs: 1_000 });
    const done = drain(h).run(ctx);
    await vi.advanceTimersByTimeAsync(999);
    expect(db.retryJob).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const counters = await done;
    expect(db.retryJob).toHaveBeenCalledWith(ctxDb, expect.anything(), expect.any(String), "the job ran past its timeout (1000 ms)", expect.any(String));
    expect(signal?.aborted).toBe(true);
    expect(counters).toMatchObject({ retried: 1, succeeded: 0 });
  });

  it("8b. a job that finishes in time leaves no timer behind", async () => {
    vi.useFakeTimers();
    queue(row({ timeout_ms: 1_000 }));
    await drain(handler(async () => {})).run(ctx);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("9. the drain never starts a job that might not fit its budget: elapsed + the 60 s job ceiling > 200 s stops it (mutation: drop the fit check → claimJob twice, FAILS)", async () => {
    let t = T0;
    queue(row(), row(), row());
    const h = handler(async () => { t += 140_001; });
    const counters = await drain(h, () => t).run(ctx);
    expect(db.claimJob).toHaveBeenCalledTimes(1);
    expect(counters).toMatchObject({ claimed: 1, succeeded: 1, notStartedBudget: 1 });
  });

  it("9b. at exactly the fit (elapsed + 60 s = 200 s) the next job is still started", async () => {
    let t = T0;
    queue(row(), row());
    const h = handler(async () => { t += 140_000; });
    const counters = await drain(h, () => t).run(ctx);
    expect(db.claimJob).toHaveBeenCalledTimes(2);
    expect(counters).toMatchObject({ claimed: 2, notStartedBudget: 1 });
  });

  it("10. at most JOBS_PER_DRAIN (100) claims per drain (mutation: drop the cap → 150, FAILS)", async () => {
    db.claimJob.mockReset();
    let n = 0;
    db.claimJob.mockImplementation(async () => (++n > 150 ? null : row()));
    const counters = await drain(handler(async () => {})).run(ctx);
    expect(db.claimJob).toHaveBeenCalledTimes(100);
    expect(counters).toMatchObject({ claimed: 100, succeeded: 100, notStartedBudget: 0 });
  });

  it("11. claims exactly the handler map's own kinds, on the tick's client (mutation: pass [] → FAILS)", async () => {
    const h = handler(async () => {});
    await makeJobsDrainPass({ handlers: { "a.one": h, "b.two": h }, clock: () => T0, random: () => 0.5, beat }).run(ctx);
    expect(db.claimJob).toHaveBeenCalledWith(ctxDb, ["a.one", "b.two"]);
  });

  it("11b. a claimJob that throws rejects the pass (the harness records errored and a failed cron.pass.jobsDrain)", async () => {
    db.claimJob.mockReset().mockRejectedValue(new Error("claimJob failed: boom"));
    await expect(drain(handler(async () => {})).run(ctx)).rejects.toThrow("claimJob failed: boom");
  });

  it("11c. a claimed kind with no handler in the map takes the failure path with fixed text, and nothing runs", async () => {
    queue(row({ kind: "gone.kind", attempts: 1, max_attempts: 3 }));
    const h = handler(async () => {});
    const counters = await drain(h).run(ctx);
    expect(db.retryJob).toHaveBeenCalledWith(ctxDb, expect.anything(), new Date(T0 + 15 * MIN).toISOString(), "no handler is registered for this job's kind", expect.any(String));
    expect(h.run).not.toHaveBeenCalled();
    expect(counters).toMatchObject({ claimed: 1, retried: 1 });
  });

  it("12. jobs.dead: failed naming each kind and the total; ok when none; '1000 or more' when the read hit its cap, never a bare total (mutation: always ok → FAILS)", async () => {
    db.deadJobCounts.mockResolvedValueOnce({ counts: { "calendar.push": 2 }, truncated: false });
    await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.dead")).toEqual([{ ok: false, error: "2 jobs gave up: calendar.push (2)" }]);
    expect(beat.mock.calls[0]![0]).toBe(ctxDb);

    beat.mockClear();
    db.deadJobCounts.mockResolvedValueOnce({ counts: { "z.last": 1, "a.first": 3 }, truncated: false });
    await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.dead")).toEqual([{ ok: false, error: "4 jobs gave up: a.first (3), z.last (1)" }]);

    beat.mockClear();
    db.deadJobCounts.mockResolvedValueOnce({ counts: { "a.first": 1 }, truncated: false });
    await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.dead")).toEqual([{ ok: false, error: "1 job gave up: a.first (1)" }]);

    beat.mockClear();
    db.deadJobCounts.mockResolvedValueOnce({ counts: {}, truncated: false });
    await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.dead")).toEqual([{ ok: true }]);

    beat.mockClear();
    db.deadJobCounts.mockResolvedValueOnce({ counts: { "calendar.push": 600, "sms.send": 400 }, truncated: true });
    await drain(handler(async () => {})).run(ctx);
    const [truncated] = beatsFor("jobs.dead") as { ok: false; error: string }[];
    expect(truncated).toEqual({ ok: false, error: "1000 or more jobs gave up, among them: calendar.push (600), sms.send (400)" });
    // The bare total of the rows read is never stated as the count.
    expect(truncated!.error).not.toMatch(/^1000 jobs/);
  });

  it("13. jobs.backlog: failed naming the kind past 60 minutes, ok under it; oldestWaitMinutes floors (mutation: always ok → FAILS)", async () => {
    db.oldestDueJob.mockResolvedValueOnce({ kind: "calendar.push", runAfter: new Date(T0 - 61 * MIN - 30_000).toISOString() });
    const late = await drain(handler(async () => {})).run(ctx);
    expect(db.oldestDueJob).toHaveBeenCalledWith(ctxDb, new Date(T0).toISOString());
    expect(beatsFor("jobs.backlog")).toEqual([{ ok: false, error: "the oldest waiting job (calendar.push) has waited 61 minutes" }]);
    expect(late.oldestWaitMinutes).toBe(61);

    beat.mockClear();
    db.oldestDueJob.mockResolvedValueOnce({ kind: "calendar.push", runAfter: new Date(T0 - 59 * MIN).toISOString() });
    const fine = await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.backlog")).toEqual([{ ok: true }]);
    expect(fine.oldestWaitMinutes).toBe(59);

    beat.mockClear();
    db.oldestDueJob.mockResolvedValueOnce({ kind: "calendar.push", runAfter: new Date(T0 - 60 * MIN).toISOString() });
    await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.backlog")).toEqual([{ ok: true }]);

    beat.mockClear();
    db.oldestDueJob.mockResolvedValueOnce(null);
    const empty = await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.backlog")).toEqual([{ ok: true }]);
    expect(empty.oldestWaitMinutes).toBe(0);
  });

  it("13b. a read that throws is logged and its key is not written; the other key still is", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.deadJobCounts.mockRejectedValueOnce(new Error("deadJobCounts failed: x"));
    db.oldestDueJob.mockRejectedValueOnce(new Error("oldestDueJob failed: y"));
    const counters = await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.dead")).toEqual([]);
    expect(beatsFor("jobs.backlog")).toEqual([]);
    expect(err).toHaveBeenCalledTimes(2);
    expect("oldestWaitMinutes" in counters).toBe(false);

    beat.mockClear();
    db.deadJobCounts.mockRejectedValueOnce(new Error("deadJobCounts failed: x"));
    await drain(handler(async () => {})).run(ctx);
    expect(beatsFor("jobs.dead")).toEqual([]);
    expect(beatsFor("jobs.backlog")).toEqual([{ ok: true }]);
  });

  it("14. sweeps 500 and reports the count; a sweep that throws still writes both heartbeats AND rejects the pass (mutation: swallow the sweep error → the pass resolves, FAILS)", async () => {
    db.sweepJobs.mockResolvedValueOnce(37);
    const counters = await drain(handler(async () => {})).run(ctx);
    expect(db.sweepJobs).toHaveBeenCalledWith(ctxDb, 500);
    expect(counters.swept).toBe(37);

    beat.mockClear();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    queue(row());
    db.sweepJobs.mockRejectedValueOnce(new Error("sweepJobs failed: z"));
    await expect(drain(handler(async () => {})).run(ctx)).rejects.toThrow("sweepJobs failed: z");
    expect(beatsFor("jobs.dead")).toEqual([{ ok: true }]);
    expect(beatsFor("jobs.backlog")).toEqual([{ ok: true }]);
    // The work it did is not lost to the rethrow: the counters are logged first.
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain('"succeeded":1');
  });

  it("the default deps write through recordHeartbeat on the tick's client", async () => {
    await makeJobsDrainPass({ handlers: {} }).run(ctx);
    expect(db.recordHeartbeat).toHaveBeenCalledWith(ctxDb, "jobs.dead", { ok: true });
    expect(db.recordHeartbeat).toHaveBeenCalledWith(ctxDb, "jobs.backlog", { ok: true });
  });
});
