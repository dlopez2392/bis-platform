import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-196: the dispatcher. With `CRON_FANOUT=1` and `APP_ORIGIN` set, the cron
 * route walks `PLAN` and POSTs each node to its own pass route; otherwise it
 * runs today's single in-process tick (route.test.ts, unedited, is the proof
 * that path is byte-identical). Here the in-process tick is a spy, so the
 * question each case asks is only WHICH path ran.
 */
const runPassesSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/harness", async (o) => ({
  ...(await o<object>()), runPasses: runPassesSpy, buildPassContext: () => ({}),
}));
const db = vi.hoisted(() => ({ tag: "service-db" }));
const serviceDbSpy = vi.hoisted(() => vi.fn());
const beatSpy = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (o) => ({ ...(await o<object>()), serviceDb: serviceDbSpy, recordHeartbeat: beatSpy }));

import { GET } from "./route";
import { PLAN } from "@/lib/automations/fanout";

const SECRET = "dispatch-secret";
const fetchSpy = vi.fn();
const TICK_AT = new Date("2026-10-28T14:00:00.000Z");

const cronReq = () => new Request("https://bis-platform.vercel.app/api/cron/reminders", {
  headers: { authorization: `Bearer ${SECRET}` },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TICK_AT);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("CRON_FANOUT", "");
  vi.stubEnv("APP_ORIGIN", "");
  runPassesSpy.mockReset().mockResolvedValue({ reminders: { sent: 2 }, followups: { sent: 0 } });
  serviceDbSpy.mockReset().mockReturnValue(db);
  beatSpy.mockReset().mockResolvedValue(undefined);
  fetchSpy.mockReset().mockImplementation(async (url: string) => {
    const body = url.endsWith("/api/cron/pass/reminders") ? { sent: 2, failed: 0 } : { sent: 0 };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/cron/reminders — the dispatcher behind CRON_FANOUT", () => {
  it("(a) switch off: the single in-process tick, the same JSON, no fetch and no heartbeat of the route's own", async () => {
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify({ sent: 2, followups: { sent: 0 } }));
    expect(runPassesSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beatSpy).not.toHaveBeenCalled();
  });

  it("(b) switch on with APP_ORIGIN: every plan node POSTed once to its pass route with one now and the bearer; reminders top-level, the rest nested; one cron.tick (mutation: nest reminders → FAILS)", async () => {
    vi.stubEnv("CRON_FANOUT", "1");
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(21);
    const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect([...urls].sort()).toEqual(PLAN.map((n) => `https://app.example.com/api/cron/pass/${n.key}`).sort());
    for (const [, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ now: TICK_AT.toISOString() });
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    }
    expect(runPassesSpy).not.toHaveBeenCalled();

    const json = await res.json() as Record<string, unknown>;
    expect(json).toMatchObject({ sent: 2, failed: 0, followups: { sent: 0 }, jobsDrain: { sent: 0 }, opsWatch: { sent: 0 } });
    expect(json).not.toHaveProperty("reminders");
    expect(Object.keys(json).sort()).toEqual(
      ["sent", "failed", ...PLAN.map((n) => n.key).filter((k) => k !== "reminders")].sort(),
    );

    expect(beatSpy.mock.calls).toEqual([[db, "cron.tick", { ok: true }]]);
  });

  it("(c) switch on but APP_ORIGIN unset: the in-process tick runs, and the route says so", async () => {
    vi.stubEnv("CRON_FANOUT", "1");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 2, followups: { sent: 0 } });
    expect(runPassesSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toContain("APP_ORIGIN");
  });

  it("(d) CRON_FANOUT=\"true\" is not on: the in-process tick runs", async () => {
    vi.stubEnv("CRON_FANOUT", "true");
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    expect(runPassesSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses before either path: 503 without CRON_SECRET, 401 on a wrong bearer, nothing run", async () => {
    vi.stubEnv("CRON_FANOUT", "1");
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronReq())).status).toBe(503);
    vi.stubEnv("CRON_SECRET", SECRET);
    const wrong = new Request("https://bis-platform.vercel.app/api/cron/reminders", { headers: { authorization: "Bearer nope-nope-nope-n" } });
    expect((await GET(wrong)).status).toBe(401);
    expect(runPassesSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(serviceDbSpy).not.toHaveBeenCalled();
  });
});
