import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-196 Task 8: the jobs drain in its own function, with its own 300 s
 * ceiling (JOBS_DRAIN_MAX_S; cron-coupling.test.ts reads this route's
 * literal). Everything but the pass is `handlePassRequest`: the cron's own
 * auth before any query, the tick's `now` from the body, and the pass's own
 * `cron.pass.jobsDrain` heartbeat, never `cron.tick`.
 */
const fakeDrain = vi.hoisted(() => ({ key: "jobsDrain", run: vi.fn() }));
vi.mock("@/lib/automations/passes/jobs-drain", () => ({ jobsDrainPass: fakeDrain }));

const db = vi.hoisted(() => ({ tag: "service-db" }));
const serviceDbSpy = vi.hoisted(() => vi.fn());
const beatSpy = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (o) => ({ ...(await o<object>()), serviceDb: serviceDbSpy, recordHeartbeat: beatSpy }));

// As the [key] route's test: the context's two gates are built per invocation, never reached here.
const gate = vi.hoisted(() => ({ smsSenderFor: vi.fn() }));
vi.mock("@/lib/consent/gate", () => gate);
const emailGate = vi.hoisted(() => ({ emailSenderFor: vi.fn() }));
vi.mock("@/lib/consent/email-gate", () => emailGate);

import * as mod from "./route";
import { POST } from "./route";

const SECRET = "drain-secret";
const ORIGIN = "https://app.example.com";
const WALL = new Date("2026-10-28T14:00:00.000Z");

function req(body: unknown, auth: string | null = `Bearer ${SECRET}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  return new Request(`${ORIGIN}/api/cron/pass/jobsDrain`, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WALL);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  fakeDrain.run.mockReset().mockResolvedValue({ claimed: 2, succeeded: 2 });
  serviceDbSpy.mockReset().mockReturnValue(db);
  beatSpy.mockReset().mockResolvedValue(undefined);
  gate.smsSenderFor.mockReset().mockReturnValue(vi.fn());
  emailGate.emailSenderFor.mockReset().mockReturnValue({ isFake: true, send: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const nothingRan = () => {
  expect(serviceDbSpy).not.toHaveBeenCalled();
  expect(fakeDrain.run).not.toHaveBeenCalled();
  expect(beatSpy).not.toHaveBeenCalled();
};

describe("POST /api/cron/pass/jobsDrain", () => {
  it("503s with zero queries when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req({ now: WALL.toISOString() }))).status).toBe(503);
    nothingRan();
  });

  it("401s with zero queries on a wrong bearer, and on none", async () => {
    expect((await POST(req({ now: WALL.toISOString() }, "Bearer wrong")))).toHaveProperty("status", 401);
    expect((await POST(req({ now: WALL.toISOString() }, null)))).toHaveProperty("status", 401);
    nothingRan();
  });

  it("runs the drain once on the body's instant, answers its counters and writes cron.pass.jobsDrain, never cron.tick", async () => {
    const tickNow = new Date(WALL.getTime() - 300_000);
    const res = await POST(req({ now: tickNow.toISOString() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 2, succeeded: 2 });
    expect(fakeDrain.run).toHaveBeenCalledTimes(1);
    const ctx = fakeDrain.run.mock.calls[0]![0] as { now: Date; db: unknown; origin: string };
    expect(ctx.now.getTime()).toBe(tickNow.getTime());
    expect(ctx.db).toBe(db);
    expect(ctx.origin).toBe(ORIGIN);
    expect(beatSpy.mock.calls).toEqual([[db, "cron.pass.jobsDrain", { ok: true }]]);
  });

  it("a drain that rejects answers 200 { errored: 1 } and its heartbeat fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDrain.run.mockRejectedValue(new Error("sweepJobs failed: z"));
    const res = await POST(req({ now: WALL.toISOString() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ errored: 1 });
    expect(beatSpy.mock.calls).toEqual([[db, "cron.pass.jobsDrain", { ok: false, error: "Error: sweepJobs failed: z" }]]);
  });

  it("is POST only, dynamic, with a 300 s ceiling (mutation: export a GET → FAILS)", () => {
    expect("GET" in mod).toBe(false);
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.maxDuration).toBe(300);
  });
});
