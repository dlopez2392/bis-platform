import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  insertJob, claimJob, completeJob, retryJob, killJob, sweepJobs, deadJobCounts, oldestDueJob,
  JobPayloadTooLarge,
} from "../jobs";

/**
 * F-196 Task 2: `jobs.ts` against the CI project through PostgREST — the
 * shapes `claim_jobs`/`sweep_jobs` (0102) actually hand back, and the
 * compare-and-set fencing on the claim token. CI `verify` ONLY: no
 * `@bis/db` vitest that touches a database runs locally against bis-ci on
 * this branch (0102 is not there yet, so the global-setup fixture sweep
 * over `ACCOUNT_OWNED_TABLES` — which now lists `jobs` — would fail before
 * a single test ran). Platform jobs only (`account_id` null) except the one
 * case that needs a second account to prove the duplicate read-back is
 * scoped per account; that half tears its own account down with
 * `withTestAccount` and every platform row this file writes is deleted by
 * kind in `afterAll`.
 */
const RUN = randomUUID().slice(0, 8);
const KIND = `s${RUN}.store`;

function soon(ms = 0): string {
  return new Date(Date.now() + ms).toISOString();
}

afterAll(async () => {
  const db = serviceDb();
  const { error } = await db.from("jobs").delete().eq("kind", KIND);
  if (error) throw new Error(`jobs-store.test cleanup failed on jobs (kind ${KIND}): ${error.message}`);
});

describe("jobs.ts: insertJob", () => {
  it("is idempotent per (kind, account, key): a repeat read back the same row, and a dead duplicate still answers dead " +
     "(mutation: drop the 23505 branch -> the second call throws, FAILS)", async () => {
    const db = serviceDb();
    const key = `dup-${RUN}`;
    // Due by a minute, so clock skew between this runner and the DB server can never make the claim below see it as not-yet-due.
    const runAfter = soon(-60_000);

    const first = await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: key, payload: { n: 1 }, runAfter, maxAttempts: 3, timeoutMs: 5000 });
    expect(first).toEqual({ id: expect.any(String), created: true, state: "queued" });

    const second = await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: key, payload: { n: 2 }, runAfter, maxAttempts: 3, timeoutMs: 5000 });
    expect(second).toEqual({ id: first.id, created: false, state: "queued" });

    const claimed = await claimJob(db, [KIND]);
    expect(claimed?.id).toBe(first.id);
    const fence = { id: claimed!.id, claimToken: claimed!.claim_token! };
    expect(await killJob(db, fence, "boom", soon())).toBe(true);

    const third = await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: key, payload: { n: 3 }, runAfter, maxAttempts: 3, timeoutMs: 5000 });
    expect(third).toEqual({ id: first.id, created: false, state: "dead" });
  });

  it("the duplicate read-back is scoped to the SAME account: a platform job and a fixture account's job under the identical " +
     "(kind, key) are two different rows, and a second platform insert finds the platform row, not the account's " +
     "(mutation: drop the account filter from the read-back -> the wrong row is read, or the read-back matches more than " +
     "one row and throws; either way this test FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const key = `acct-${RUN}`;
      const runAfter = soon();

      const forAccount = await insertJob(db, { kind: KIND, accountId, idempotencyKey: key, payload: {}, runAfter, maxAttempts: 3, timeoutMs: 5000 });
      expect(forAccount.created).toBe(true);

      const platformFirst = await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: key, payload: {}, runAfter, maxAttempts: 3, timeoutMs: 5000 });
      expect(platformFirst.created).toBe(true);
      expect(platformFirst.id).not.toBe(forAccount.id);

      const platformAgain = await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: key, payload: {}, runAfter, maxAttempts: 3, timeoutMs: 5000 });
      expect(platformAgain).toEqual({ id: platformFirst.id, created: false, state: "queued" });

      const svc = serviceDb();
      const { error } = await svc.from("jobs").delete().eq("kind", KIND).is("account_id", null).eq("idempotency_key", key);
      if (error) throw new Error(`jobs-store.test cleanup failed on jobs (kind ${KIND}, key ${key}): ${error.message}`);
    }));

  it("rejects a payload over jsonb's 8 KB CHECK even though JSON.stringify sees far fewer bytes " +
     "(0102's CHECK measures octet_length(payload::text), not JSON.stringify's byte count) " +
     "(mutation: drop the 23514 mapping -> a plain Error instead of JobPayloadTooLarge, FAILS)", async () => {
    const db = serviceDb();
    const payload: Record<string, number> = {};
    for (let i = 0; i < 30; i++) payload[`k${i}`] = 1e300;
    expect(JSON.stringify(payload).length).toBeLessThan(8192);

    await expect(insertJob(db, {
      kind: KIND, accountId: null, idempotencyKey: `big-${RUN}`, payload, runAfter: soon(), maxAttempts: 3, timeoutMs: 5000,
    })).rejects.toBeInstanceOf(JobPayloadTooLarge);
  });
});

describe("jobs.ts: claimJob and the three finishers", () => {
  it("completeJob is fenced by the claim token: a wrong token touches nothing, the right token finishes the row " +
     "(mutation: drop .eq('claim_token', ...) -> the wrong-token call returns true, FAILS)", async () => {
    const db = serviceDb();
    const key = `complete-${RUN}`;
    // Due by a minute (not soon(0)): clock skew between this runner and the DB server must not hide the row from the claim below.
    await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: key, payload: {}, runAfter: soon(-60_000), maxAttempts: 3, timeoutMs: 5000 });

    const claimed = await claimJob(db, [KIND]);
    expect(claimed).not.toBeNull();
    const fence = { id: claimed!.id, claimToken: claimed!.claim_token! };

    // A well-formed but WRONG uuid: claim_token is a uuid column, so a non-uuid string here would die on
    // PostgREST's cast (22P02) instead of exercising the fence itself (opus review, relationships.test.ts:61-62).
    expect(await completeJob(db, { id: fence.id, claimToken: randomUUID() }, soon())).toBe(false);
    const stillRunning = (await db.from("jobs").select("state").eq("id", fence.id).single()).data as { state: string };
    expect(stillRunning.state).toBe("running");

    const atIso = soon();
    expect(await completeJob(db, fence, atIso)).toBe(true);
    const done = (await db.from("jobs").select("state, finished_at, lease_until, claim_token").eq("id", fence.id).single())
      .data as { state: string; finished_at: string; lease_until: string | null; claim_token: string | null };
    expect(done.state).toBe("succeeded");
    expect(Date.parse(done.finished_at)).toBe(Date.parse(atIso));
    expect(done.lease_until).toBeNull();
    expect(done.claim_token).toBeNull();
  });

  it("retryJob truncates last_error to 300 characters, moves run_after and clears the lease " +
     "(mutation: write error unbounded -> the CHECK refuses with 23514, FAILS)", async () => {
    const db = serviceDb();
    // Due by a minute: clock skew between this runner and the DB server must not hide the row from the claim below.
    await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: `retry-${RUN}`, payload: {}, runAfter: soon(-60_000), maxAttempts: 3, timeoutMs: 5000 });

    const claimed = await claimJob(db, [KIND]);
    const fence = { id: claimed!.id, claimToken: claimed!.claim_token! };
    const runAfter = soon(60 * 60_000);
    const atIso = soon();

    expect(await retryJob(db, fence, runAfter, "x".repeat(400), atIso)).toBe(true);
    const row = (await db.from("jobs").select("state, last_error, lease_until, claim_token, run_after").eq("id", fence.id).single())
      .data as { state: string; last_error: string; lease_until: string | null; claim_token: string | null; run_after: string };
    expect(row.state).toBe("retrying");
    expect(row.last_error).toBe("x".repeat(300));
    expect(row.lease_until).toBeNull();
    expect(row.claim_token).toBeNull();
    expect(Date.parse(row.run_after)).toBe(Date.parse(runAfter));
    // left `run_after` an hour out: not due, so it never lands in another case's claimJob and never needs a kill.
  });

  it("killJob marks a row dead with finished_at and last_error set", async () => {
    const db = serviceDb();
    // Due by a minute: clock skew between this runner and the DB server must not hide the row from the claim below.
    await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: `kill-${RUN}`, payload: {}, runAfter: soon(-60_000), maxAttempts: 1, timeoutMs: 5000 });

    const claimed = await claimJob(db, [KIND]);
    const fence = { id: claimed!.id, claimToken: claimed!.claim_token! };
    const atIso = soon();
    expect(await killJob(db, fence, "dead for good", atIso)).toBe(true);

    const row = (await db.from("jobs").select("state, finished_at, last_error").eq("id", fence.id).single())
      .data as { state: string; finished_at: string; last_error: string };
    expect(row.state).toBe("dead");
    expect(Date.parse(row.finished_at)).toBe(Date.parse(atIso));
    expect(row.last_error).toBe("dead for good");
  });
});

describe("jobs.ts: the reads", () => {
  it("deadJobCounts counts this run's dead rows under its own kind (two: the killed duplicate above and the killJob case), " +
     "and reports whether the read hit its row cap", async () => {
    const db = serviceDb();
    const { counts, truncated } = await deadJobCounts(db);
    expect(counts[KIND]).toBe(2);
    expect(typeof truncated).toBe("boolean");
  });

  it("oldestDueJob is the earliest due queued/retrying row across the whole table, as of the moment given " +
     "(mutation: drop .lte('run_after', nowIso) -> the second call still returns the row, FAILS)", async () => {
    const db = serviceDb();
    const runAfter = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
    await insertJob(db, { kind: KIND, accountId: null, idempotencyKey: `oldest-${RUN}`, payload: {}, runAfter, maxAttempts: 3, timeoutMs: 5000 });

    const due = await oldestDueJob(db, new Date().toISOString());
    expect(due?.kind).toBe(KIND);
    expect(Date.parse(due!.runAfter)).toBe(Date.parse(runAfter));

    const tooEarly = new Date(Date.now() - 11 * 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(await oldestDueJob(db, tooEarly)).toBeNull();
  });

  it("sweepJobs answers a count (the retention rule itself belongs to migration 0102)", async () => {
    const db = serviceDb();
    const n = await sweepJobs(db, 1);
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
