import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bare factory (Global Constraints: only enqueue.ts and the drain import the
 * new jobs.ts exports; only new test files import those two). It also
 * defines JobPayloadTooLarge itself — a missing export throws when the
 * oversize-payload path reaches `new JobPayloadTooLarge(...)` inside
 * enqueue.ts, since this mock replaces the whole "@bis/db" module.
 */
const mocked = vi.hoisted(() => {
  class JobPayloadTooLarge extends Error {}
  return {
    insertJob: vi.fn(),
    serviceDb: vi.fn(),
    JobPayloadTooLarge,
  };
});
vi.mock("@bis/db", () => mocked);

import { enqueue } from "./enqueue";
import { JobPayloadTooLarge } from "@bis/db";
import { platformPing } from "./platform-ping";

const FAKE_DB = { marker: "explicit-db" };

beforeEach(() => {
  mocked.insertJob.mockReset().mockResolvedValue({ id: "job1", created: true, state: "queued" });
  mocked.serviceDb.mockReset().mockReturnValue({ marker: "service-db" });
});

describe("enqueue — the one door into the jobs table", () => {
  it("copies maxAttempts and timeoutMs from the handler, and defaults runAfter to now", async () => {
    const before = Date.now();
    await enqueue("platform.ping", {}, { idempotencyKey: "k1", accountId: null });
    expect(mocked.insertJob).toHaveBeenCalledTimes(1);
    const [, job] = mocked.insertJob.mock.calls[0]!;
    expect(job.kind).toBe("platform.ping");
    expect(job.maxAttempts).toBe(platformPing.maxAttempts);
    expect(job.timeoutMs).toBe(platformPing.timeoutMs);
    expect(job.idempotencyKey).toBe("k1");
    expect(job.accountId).toBeNull();
    expect(job.payload).toEqual({});
    expect(new Date(job.runAfter).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(job.runAfter).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a runAfter given in opts is used instead of now", async () => {
    const runAfter = new Date("2030-01-01T00:00:00Z");
    await enqueue("platform.ping", {}, { idempotencyKey: "k2", accountId: null, runAfter });
    const [, job] = mocked.insertJob.mock.calls[0]!;
    expect(job.runAfter).toBe(runAfter.toISOString());
  });

  it("a collision answer passes through with its state", async () => {
    mocked.insertJob.mockResolvedValue({ id: "job1", created: false, state: "dead" });
    const result = await enqueue("platform.ping", {}, { idempotencyKey: "k3", accountId: null });
    expect(result).toEqual({ id: "job1", created: false, state: "dead" });
  });

  it("a JobPayloadTooLarge thrown by insertJob (0102's own CHECK) propagates as that class", async () => {
    mocked.insertJob.mockRejectedValue(new JobPayloadTooLarge("the job's payload is over 8 KB"));
    await expect(
      enqueue("platform.ping", {}, { idempotencyKey: "k4", accountId: null }),
    ).rejects.toBeInstanceOf(JobPayloadTooLarge);
  });

  it("an unknown kind throws before insertJob is ever called", async () => {
    // @ts-expect-error — "nope.kind" is not a registered JobKind
    await expect(enqueue("nope.kind", {}, { idempotencyKey: "k5", accountId: null })).rejects.toThrow();
    expect(mocked.insertJob).not.toHaveBeenCalled();
  });

  it("a payload over 8,192 bytes throws JobPayloadTooLarge before insertJob is called", async () => {
    const big = { a: "x".repeat(8_193) };
    await expect(
      enqueue("platform.ping", big as never, { idempotencyKey: "k6", accountId: null }),
    ).rejects.toBeInstanceOf(JobPayloadTooLarge);
    expect(mocked.insertJob).not.toHaveBeenCalled();
  });

  it("an empty idempotency key throws before insertJob", async () => {
    await expect(enqueue("platform.ping", {}, { idempotencyKey: "", accountId: null })).rejects.toThrow();
    expect(mocked.insertJob).not.toHaveBeenCalled();
  });

  it("a 201-character idempotency key throws before insertJob", async () => {
    await expect(
      enqueue("platform.ping", {}, { idempotencyKey: "a".repeat(201), accountId: null }),
    ).rejects.toThrow();
    expect(mocked.insertJob).not.toHaveBeenCalled();
  });

  it("opts.db is used when given; serviceDb() is never called", async () => {
    await enqueue("platform.ping", {}, { idempotencyKey: "k7", accountId: null, db: FAKE_DB as never });
    expect(mocked.serviceDb).not.toHaveBeenCalled();
    expect(mocked.insertJob.mock.calls[0]![0]).toBe(FAKE_DB);
  });

  it("serviceDb() is called when no db is given", async () => {
    await enqueue("platform.ping", {}, { idempotencyKey: "k8", accountId: null });
    expect(mocked.serviceDb).toHaveBeenCalledTimes(1);
    expect(mocked.insertJob.mock.calls[0]![0]).toEqual({ marker: "service-db" });
  });
});
