import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-196: each pass in its own function. The dispatcher POSTs here once per
 * plan node with the tick's `now`; this route answers that pass's counters
 * and writes that pass's heartbeat, never `cron.tick` (the dispatcher writes
 * that once, after every node is decided). Auth is the cron's own: no
 * secret configured → 503, a wrong bearer → 401, both before any query.
 */
const fakeA = vi.hoisted(() => ({ key: "a", run: vi.fn() }));
const fakeBoom = vi.hoisted(() => ({ key: "boom", run: vi.fn() }));
vi.mock("@/lib/automations/registry", () => ({ PASSES: [fakeA, fakeBoom] }));

const db = vi.hoisted(() => ({ tag: "service-db" }));
const serviceDbSpy = vi.hoisted(() => vi.fn());
const beatSpy = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (o) => ({ ...(await o<object>()), serviceDb: serviceDbSpy, recordHeartbeat: beatSpy }));

// As harness.test.ts: the context's two gates are built per invocation, never reached here.
const gate = vi.hoisted(() => ({ smsSenderFor: vi.fn() }));
vi.mock("@/lib/consent/gate", () => gate);
const emailGate = vi.hoisted(() => ({ emailSenderFor: vi.fn() }));
vi.mock("@/lib/consent/email-gate", () => emailGate);

import * as mod from "./route";
import { POST } from "./route";

const SECRET = "pass-secret";
const ORIGIN = "https://app.example.com";
const WALL = new Date("2026-10-28T14:00:00.000Z");

function req(key: string, body: unknown, auth: string | null = `Bearer ${SECRET}`): [Request, { params: Promise<{ key: string }> }] {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  const r = new Request(`${ORIGIN}/api/cron/pass/${key}`, {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return [r, { params: Promise.resolve({ key }) }];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WALL);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  fakeA.run.mockReset().mockResolvedValue({ sent: 1 });
  fakeBoom.run.mockReset().mockRejectedValue(new Error("db exploded"));
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
  expect(fakeA.run).not.toHaveBeenCalled();
  expect(fakeBoom.run).not.toHaveBeenCalled();
  expect(beatSpy).not.toHaveBeenCalled();
};

describe("POST /api/cron/pass/[key]", () => {
  it("503s with zero queries when CRON_SECRET is unset (mutation: drop the unset check → FAILS)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(...req("a", { now: WALL.toISOString() }));
    expect(res.status).toBe(503);
    nothingRan();
  });

  it("401s with zero queries on a wrong bearer, and on none", async () => {
    expect((await POST(...req("a", { now: WALL.toISOString() }, "Bearer wrong-secret"))).status).toBe(401);
    expect((await POST(...req("a", { now: WALL.toISOString() }, null))).status).toBe(401);
    nothingRan();
  });

  it("404s an unknown key with zero queries", async () => {
    const res = await POST(...req("nope", { now: WALL.toISOString() }));
    expect(res.status).toBe(404);
    nothingRan();
  });

  it("400s a stale now, a body without one, and a body that is not JSON, with zero queries", async () => {
    const stale = new Date(WALL.getTime() - 900_001).toISOString();
    expect((await POST(...req("a", { now: stale }))).status).toBe(400);
    expect((await POST(...req("a", {}))).status).toBe(400);
    expect((await POST(...req("a", "not json"))).status).toBe(400);
    nothingRan();
  });

  it("503s with zero queries when APP_ORIGIN is unset: a link is never built from a request host under fan-out", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    const res = await POST(...req("a", { now: WALL.toISOString() }));
    expect(res.status).toBe(503);
    nothingRan();
  });

  it("runs only the named pass, on the body's instant and APP_ORIGIN, and writes its heartbeat and never cron.tick (mutation: runPasses([pass], ctx) → FAILS)", async () => {
    // The body's now is 10 minutes behind the route's own clock: the pass
    // must see the TICK's instant, not this function's.
    const tickNow = new Date(WALL.getTime() - 600_000);
    const res = await POST(...req("a", { now: tickNow.toISOString() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1 });
    expect(fakeA.run).toHaveBeenCalledTimes(1);
    const ctx = fakeA.run.mock.calls[0]![0] as { now: Date; origin: string; db: unknown };
    expect(ctx.now.getTime()).toBe(tickNow.getTime());
    expect(ctx.origin).toBe(ORIGIN);
    expect(ctx.db).toBe(db);
    expect(fakeBoom.run).not.toHaveBeenCalled();
    expect(beatSpy.mock.calls).toEqual([[db, "cron.pass.a", { ok: true }]]);
  });

  it("a pass that throws answers 200 { errored: 1 } and writes its failed heartbeat", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(...req("boom", { now: WALL.toISOString() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ errored: 1 });
    expect(beatSpy.mock.calls).toEqual([[db, "cron.pass.boom", { ok: false, error: "Error: db exploded" }]]);
  });

  it("is POST only: the module exports no GET (mutation: export a GET → FAILS)", () => {
    expect("GET" in mod).toBe(false);
    expect(mod.dynamic).toBe("force-dynamic");
  });
});
