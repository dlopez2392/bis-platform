import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listHeartbeatsMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  listHeartbeats: (...a: unknown[]) => listHeartbeatsMock(...a),
}));

import { GET, STALE_AFTER_MS } from "./route";

const NOW = new Date("2026-10-01T15:00:00Z");
const req = (auth?: string) => new Request("https://app.example.com/api/ops/health", auth ? { headers: { authorization: auth } } : {});
const tick = (msAgo: number) => [{ key: "cron.tick", lastOkAt: new Date(NOW.getTime() - msAgo).toISOString(), lastErrorAt: null, lastError: null, consecutiveFailures: 0, alertedAt: null }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.OPS_HEALTH_SECRET = "health-test-secret";
  listHeartbeatsMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.OPS_HEALTH_SECRET;
});

describe("GET /api/ops/health — operational-floor spec §1", () => {
  it("401 with no body and no query without the bearer (mutation: drop the compare → FAILS)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(listHeartbeatsMock).not.toHaveBeenCalled();
  });

  it("401 for CRON_SECRET's value: the health key and the cron key are different keys", async () => {
    process.env.CRON_SECRET = "cron-secret";
    expect((await GET(req("Bearer cron-secret"))).status).toBe(401);
    delete process.env.CRON_SECRET;
  });

  it("503 to everyone when OPS_HEALTH_SECRET is unset, so a missed setup step turns the workflow red", async () => {
    delete process.env.OPS_HEALTH_SECRET;
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(503);
    expect(listHeartbeatsMock).not.toHaveBeenCalled();
  });

  it("200 when the last completed tick is 44 minutes old", async () => {
    listHeartbeatsMock.mockResolvedValue(tick(44 * 60_000));
    const res = await GET(req("Bearer health-test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("503 naming cron.tick when the last tick is 46 minutes old (mutation: widen STALE_AFTER_MS → FAILS)", async () => {
    expect(STALE_AFTER_MS).toBe(45 * 60_000);
    listHeartbeatsMock.mockResolvedValue(tick(46 * 60_000));
    const res = await GET(req("Bearer health-test-secret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, failing: ["cron.tick"] });
  });

  it("503 when no tick has ever been recorded", async () => {
    listHeartbeatsMock.mockResolvedValue([]);
    expect((await GET(req("Bearer health-test-secret"))).status).toBe(503);
  });

  it("503 naming only 'database' when the read fails: the error text never reaches the body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listHeartbeatsMock.mockRejectedValue(new Error("password authentication failed for user postgres.secretref"));
    const res = await GET(req("Bearer health-test-secret"));
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ ok: false, failing: ["database"] }));
    expect(body).not.toContain("secretref");
  });
});
