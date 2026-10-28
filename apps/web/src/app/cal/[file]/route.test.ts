import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const m = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/booking/calendar-feed", () => ({ loadCalendarFeed: (...a: unknown[]) => m.load(...a) }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({}) }));
import { GET, HEAD } from "./route";

const TOKEN = "T".repeat(43);
const SECRET = "s".repeat(40);
const call = (file: string, init: RequestInit = {}, fn = GET) =>
  fn(new Request(`https://app.bis-rgv.com/cal/${file}`, { headers: { host: "app.bis-rgv.com" }, ...init }), { params: Promise.resolve({ file }) });
const snapshot = async (r: Response) => ({ status: r.status, body: await r.text(), headers: [...r.headers.entries()].sort() });
beforeEach(() => {
  m.load.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CALENDAR_FEED_SECRET", SECRET);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /cal/[file] — the owner's calendar feed", () => {
  it("serves text/calendar, private, revalidated, with a weak ETag", async () => {
    m.load.mockResolvedValue({ kind: "ok", body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", feedId: "f1" });
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="bookings.ics"');
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{32}"$/);
    expect(await r.text()).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  });
  it("answers 304 with no body to a matching If-None-Match, and 200 to a stale one (mutation: ignore If-None-Match → FAILS)", async () => {
    m.load.mockResolvedValue({ kind: "ok", body: "X", feedId: "f1" });
    const etag = (await call(`${TOKEN}.ics`)).headers.get("etag")!;
    const r = await call(`${TOKEN}.ics`, { headers: { host: "app.bis-rgv.com", "if-none-match": etag } });
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
    expect((await call(`${TOKEN}.ics`, { headers: { host: "app.bis-rgv.com", "if-none-match": 'W/"0"' } })).status).toBe(200);
  });
  it("unknown, revoked and wrong-account tokens, and a bad shape, are ONE identical 404 (mutation: 410 for a revoked link → FAILS)", async () => {
    m.load.mockResolvedValue({ kind: "not_found" });
    const unknown = await snapshot(await call(`${TOKEN}.ics`));
    const revoked = await snapshot(await call(`${"R".repeat(43)}.ics`));
    const otherAccount = await snapshot(await call(`${"B".repeat(43)}.ics`));
    const badShape = await snapshot(await call("nope.ics"));
    const noSuffix = await snapshot(await call(TOKEN));
    expect(unknown).toEqual({ status: 404, body: "Not found", headers: expect.any(Array) });
    expect(Object.fromEntries(unknown.headers)).toMatchObject({ "cache-control": "no-store", "x-robots-tag": "noindex" });
    for (const s of [revoked, otherAccount, badShape, noSuffix]) expect(s).toEqual(unknown);
    expect(m.load).toHaveBeenCalledTimes(3);   // bad shapes never reach the database
  });
  it("with CALENDAR_FEED_SECRET missing or short, every fetch is that same 404 and the database is never asked (mutation: drop the secret check → FAILS)", async () => {
    m.load.mockResolvedValue({ kind: "not_found" });
    const unknown = await snapshot(await call(`${TOKEN}.ics`));
    m.load.mockReset().mockResolvedValue({ kind: "ok", body: "X", feedId: "f1" });
    for (const value of [undefined, "", "x".repeat(31)]) {
      vi.stubEnv("CALENDAR_FEED_SECRET", value);
      expect(await snapshot(await call(`${TOKEN}.ics`))).toEqual(unknown);
    }
    expect(m.load).not.toHaveBeenCalled();
  });
  it("a limited link is 429 with Retry-After in seconds, never stored", async () => {
    m.load.mockResolvedValue({ kind: "rate_limited", retryAfterSeconds: 90 });
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("90");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("a read failure is a 500 that never logs the token or the secret (mutation: log the file name → FAILS)", async () => {
    m.load.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(err.mock.calls)).not.toContain(SECRET);
  });
  it("a missing or short secret is logged by NAME, never by value (final review m3; mutation: drop the log → FAILS)", async () => {
    for (const value of [undefined, "x".repeat(31)]) {
      vi.stubEnv("CALENDAR_FEED_SECRET", value);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      err.mockClear();
      expect((await call(`${TOKEN}.ics`)).status).toBe(404);
      const logged = JSON.stringify(err.mock.calls);
      expect(logged).toContain("CALENDAR_FEED_SECRET");
      expect(logged).not.toContain("x".repeat(31));
      expect(logged).not.toContain(TOKEN);
    }
  });
  it("the 500 is noindex too (final review m5; mutation: drop the header → FAILS)", async () => {
    m.load.mockRejectedValue(new Error("db down"));
    const r = await call(`${TOKEN}.ics`);
    expect(r.status).toBe(500);
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
  });
  it("HEAD answers GET's status and headers with no body", async () => {
    m.load.mockResolvedValue({ kind: "ok", body: "X", feedId: "f1" });
    const r = await call(`${TOKEN}.ics`, {}, HEAD);
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toMatch(/^W\//);
    expect(await r.text()).toBe("");
  });
});
