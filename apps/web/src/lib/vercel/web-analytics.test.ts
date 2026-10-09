import { describe, it, expect, vi } from "vitest";
import { VercelAnalytics, VercelApiError, parseCount, parseAggregate, vercelAnalyticsFromEnv } from "./web-analytics";

/** Recorded shapes: the count shape is what bis-website returned live on
 *  2026-09-07 (`{version, query, data: {visitors, pageviews}}`); the aggregate
 *  shape follows Vercel's docs (rows keyed by the grouped dimension, with
 *  `visitors` and either `pageviews` or `count`).
 *  Mutation: in parseAggregate, read `pageviews` only (drop the `count`
 *  fallback) — the second fixture row fails. */
const COUNT_JSON = { version: 1, query: {}, data: { pageviews: 1250, visitors: 980 } };
const AGG_JSON = { version: 1, query: { groupBy: ["requestPath"] }, data: [
  { requestPath: "/", pageviews: 400, visitors: 300 },
  { requestPath: "/services", count: 120, visitors: 90 },
] };

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string>;
}>;

function fetchStub(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () =>
    ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }));
}

describe("parsers", () => {
  it("parseCount reads visitors and pageviews, refusing anything else", () => {
    expect(parseCount(COUNT_JSON)).toEqual({ visitors: 980, pageviews: 1250 });
    expect(() => parseCount({ data: {} })).toThrow(/count/);
    expect(() => parseCount(null)).toThrow(/count/);
  });
  it("parseAggregate reads the grouped key by name and accepts count as pageviews", () => {
    expect(parseAggregate(AGG_JSON, "requestPath")).toEqual([
      { value: "/", visitors: 300, pageviews: 400 },
      { value: "/services", visitors: 90, pageviews: 120 },
    ]);
    expect(parseAggregate({ data: [] }, "requestPath")).toEqual([]);
    expect(() => parseAggregate({ data: [{ nope: 1 }] }, "requestPath")).toThrow(/requestPath/);
  });
  // Mutation: restore `const value = row[by]` — the null row throws and the
  // day fails; delete the Others skip — the fold ranks as a page.
  it("parseAggregate reads a null dimension as '' (direct traffic) and drops the API's Others fold", () => {
    expect(parseAggregate({ data: [{ referrerHostname: null, visitors: 5, pageviews: 7 }] }, "referrerHostname"))
      .toEqual([{ value: "", visitors: 5, pageviews: 7 }]);
    expect(parseAggregate({ data: [
      { requestPath: "Others", visitors: 900, pageviews: 1000 }, { requestPath: "/", visitors: 3, pageviews: 4 },
    ] }, "requestPath")).toEqual([{ value: "/", visitors: 3, pageviews: 4 }]);
  });
});

describe("VercelAnalytics", () => {
  it("builds the count URL with projectId, teamId, since, until and the bearer header", async () => {
    const f = fetchStub(200, COUNT_JSON);
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    await api.countVisits("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
    const [url, init] = f.mock.calls[0]! as unknown as [string, { headers: Record<string, string> }];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.vercel.com/v1/query/web-analytics/visits/count");
    expect(u.searchParams.get("projectId")).toBe("prj_1");
    expect(u.searchParams.get("teamId")).toBe("team_1");
    expect(u.searchParams.get("since")).toBe("2026-09-01T05:00:00.000Z");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("aggregate passes by and limit, and fetchDayTraffic makes exactly five aggregate calls in a fixed order — requestPath (pages) BEFORE the environment total, since the total's quiet-day check needs to know whether pages already came back empty (D-053)", async () => {
    // Rows are keyed by whichever dimension the call asked for — the real
    // API's shape — so the referrerHostname/country/deviceType/environment
    // parses succeed. The `environment` call (the total) returns ONE row:
    // the production filter already restricts every aggregate call to that
    // single value, so grouping by it yields the window's un-split total —
    // ASSUMPTION, unverified live from this sandbox: Vercel accepts
    // `by=environment&limit=1` and still returns the row (it is one of the
    // runbook's own confirmed allowed groupings; the single-row response
    // shape under a filter that already admits only one value is ordinary
    // group-by arithmetic, not new API behavior).
    const f = vi.fn(async (url: string) => {
      const by = new URL(url).searchParams.get("by");
      const body = by === "environment"
        ? { version: 1, query: { groupBy: ["environment"] }, data: [{ environment: "production", pageviews: 1250, visitors: 980 }] }
        : { version: 1, query: { groupBy: [by] }, data: [
            { [by!]: "/", pageviews: 400, visitors: 300 }, { [by!]: "/services", count: 120, visitors: 90 },
          ] };
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
    expect(f).toHaveBeenCalledTimes(5);
    const bys = f.mock.calls.map(([u]) => new URL(u as string).searchParams.get("by"));
    expect(bys).toEqual(["requestPath", "environment", "referrerHostname", "country", "deviceType"]);
    expect(new URL(f.mock.calls[0]![0] as string).searchParams.get("limit")).toBe("20");
    expect(new URL(f.mock.calls[1]![0] as string).searchParams.get("limit")).toBe("1");
    // Mutation: drop the filter from aggregate() — previews leak into the breakdowns AND the total.
    expect(new URL(f.mock.calls[0]![0] as string).searchParams.get("filter")).toBe("environment eq 'production'");
    expect(new URL(f.mock.calls[1]![0] as string).searchParams.get("filter")).toBe("environment eq 'production'");
    expect(day.visitors).toBe(980);
    expect(day.pageviews).toBe(1250);
    expect(day.pages).toHaveLength(2);
  });

  it("every aggregate call sends `until` one hour earlier than passed, countering Vercel's inclusive-until bucket (runbook's First-night findings; verified live, not from this sandbox)", async () => {
    const f = fetchStub(200, { version: 1, query: {}, data: [] });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    // Mutation: drop the `- 1h` adjustment — `until` comes back equal to the input.
    await api.aggregate("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z", "requestPath", 20);
    const u = new URL(f.mock.calls[0]![0] as string);
    expect(u.searchParams.get("since")).toBe("2026-09-01T05:00:00.000Z"); // since is untouched
    expect(u.searchParams.get("until")).toBe("2026-09-02T04:00:00.000Z");
  });

  it("countVisits (the Test Connection probe) sends `until` untouched — only aggregate carries the inclusive-until compensation", async () => {
    const f = fetchStub(200, COUNT_JSON);
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    await api.countVisits("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
    const u = new URL(f.mock.calls[0]![0] as string);
    expect(u.searchParams.get("until")).toBe("2026-09-02T05:00:00.000Z");
  });

  // The coordinator's fail-soft ask, round 2: the `environment` total call
  // is an unverified API shape, but zero rows is NOT automatically a shape
  // problem — on a real site ~29% of days have zero visitors, genuinely.
  // So: zero `environment` rows AND an empty `requestPath` breakdown is a
  // quiet day ({0,0}, no fallback, no log); zero rows with a NON-empty
  // breakdown, 2+ rows, or a parse/400 error are real shape mismatches
  // (fallback + log). A 5xx/429/network failure is NEITHER kind of shape
  // signal — it's rethrown so the pass's documented retry policy
  // (`passes/site-traffic.ts`: stop at the first failed day, whole day
  // retried next tick) handles it, instead of this call quietly stamping
  // a degraded day.
  describe("fetchDayTraffic's total: quiet days, shape fallbacks, and transient rethrows", () => {
    function routedFetch(
      envBody: { ok: boolean; status?: number; json: unknown },
      breakdownJson: unknown = { data: [{ requestPath: "/", visitors: 1, pageviews: 2 }] },
    ) {
      return vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith("visits/count")) {
          return { ok: true, status: 200, json: async () => COUNT_JSON, text: async () => "" };
        }
        const by = u.searchParams.get("by");
        if (by === "environment") {
          return { ok: envBody.ok, status: envBody.status ?? (envBody.ok ? 200 : 500), json: async () => envBody.json, text: async () => JSON.stringify(envBody.json) };
        }
        return { ok: true, status: 200, json: async () => breakdownJson, text: async () => "" };
      });
    }
    const countCalled = (f: ReturnType<typeof routedFetch>) =>
      f.mock.calls.some(([u]) => new URL(u as string).pathname.endsWith("visits/count"));

    // Mutation: drop the `!breakdownHasTraffic` guard (always return {0,0}
    // on zero rows) — the "recorded real traffic" test below starts
    // reading 0 instead of falling back, failing that test's visitors
    // assertion. Verified by mutation-probe (see report).
    it("zero environment rows AND an empty requestPath breakdown -> a genuinely quiet day: {0,0}, no fallback, no log", async () => {
      const f = routedFetch({ ok: true, json: { data: [] } }, { data: [] });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(0);
      expect(day.pageviews).toBe(0);
      expect(day.pages).toHaveLength(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(countCalled(f)).toBe(false); // no fallback call at all
      errSpy.mockRestore();
    });

    it("zero environment rows but the requestPath breakdown recorded real traffic -> shape mismatch: falls back to count and logs it", async () => {
      const f = routedFetch({ ok: true, json: { data: [] } }); // default breakdownJson has one row
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980);
      expect(day.pageviews).toBe(1250);
      const line = errSpy.mock.calls[0]![0] as string;
      expect(line).toMatch(/fell back to visits\/count/);
      expect(line).toMatch(/recorded real traffic/); // pins which branch fired, not just "it fell back"
      errSpy.mockRestore();
    });

    it("two rows from the environment aggregate -> shape mismatch: falls back to count and logs it", async () => {
      const f = routedFetch({ ok: true, json: { data: [
        { environment: "production", visitors: 10, pageviews: 20 },
        { environment: "preview", visitors: 1, pageviews: 1 },
      ] } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980);
      expect(errSpy.mock.calls[0]![0]).toMatch(/fell back to visits\/count/);
      errSpy.mockRestore();
    });

    it("a row missing `visitors` from the environment aggregate -> parseAggregate rejects -> shape problem, falls back to count", async () => {
      const f = routedFetch({ ok: true, json: { data: [{ environment: "production", pageviews: 1250 }] } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980);
      expect(errSpy.mock.calls[0]![0]).toMatch(/fell back to visits\/count/);
      errSpy.mockRestore();
    });

    it("a 400 from the environment aggregate call -> shape problem (Vercel rejected the request outright), falls back to count", async () => {
      const f = routedFetch({ ok: false, status: 400, json: { error: { message: "bad request" } } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980);
      expect(day.pageviews).toBe(1250);
      const line = errSpy.mock.calls[0]![0] as string;
      expect(line).toMatch(/fell back to visits\/count/);
      expect(line).not.toContain("tok"); // no secrets
      errSpy.mockRestore();
    });

    // Mutation: drop the `e.status !== 400` rethrow guard — this test's
    // rejection assertion fails because it falls back and resolves instead.
    it("a 500 from the environment aggregate call -> transient, RETHROWS; the day is not written, no fallback, no log", async () => {
      const f = routedFetch({ ok: false, status: 500, json: { error: { message: "boom" } } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      await expect(api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z")).rejects.toBeInstanceOf(VercelApiError);
      expect(countCalled(f)).toBe(false); // never reaches the fallback
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("a 429 from the environment aggregate call -> transient, RETHROWS the same as a 5xx", async () => {
      const f = routedFetch({ ok: false, status: 429, json: { error: { message: "rate limited" } } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      await expect(api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z")).rejects.toBeInstanceOf(VercelApiError);
      expect(countCalled(f)).toBe(false);
      errSpy.mockRestore();
    });

    it("a network-level failure (fetch itself rejects, no HTTP response at all) -> transient, RETHROWS", async () => {
      const f = vi.fn<FetchLike>(async (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("visits/count")) return { ok: true, status: 200, json: async () => COUNT_JSON, text: async () => "" };
        if (u.searchParams.get("by") === "environment") throw new TypeError("fetch failed");
        return { ok: true, status: 200, json: async () => ({ data: [{ requestPath: "/", visitors: 1, pageviews: 2 }] }), text: async () => "" };
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      await expect(api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z")).rejects.toThrow(/fetch failed/);
      expect(countCalled(f as unknown as ReturnType<typeof routedFetch>)).toBe(false);
      expect(errSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    // Happy path: the five-call test above already asserts exactly 5 fetch
    // calls for a well-formed response, which is only true when the
    // fallback does NOT fire (a fallback adds a 6th, visits/count, call).
  });

  it("listProjects reads /v9/projects for the team and returns id, name and the production domain when present", async () => {
    const f = fetchStub(200, { projects: [
      { id: "prj_1", name: "bis-website", targets: { production: { alias: ["bis-rgv.com", "bis-website.vercel.app"] } } },
      { id: "prj_2", name: "new-site" },
    ] });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    expect(await api.listProjects()).toEqual([
      { id: "prj_1", name: "bis-website", domain: "bis-rgv.com" },
      { id: "prj_2", name: "new-site", domain: null },
    ]);
    const u = new URL(f.mock.calls[0]![0] as unknown as string);
    expect(u.pathname).toBe("/v9/projects");
    expect(u.searchParams.get("teamId")).toBe("team_1");
  });

  it("a non-2xx becomes VercelApiError carrying the status and Vercel's error code", async () => {
    const f = fetchStub(400, { error: { code: "web_analytics_not_enabled", message: "Web Analytics is not enabled for this project" } });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    await expect(api.countVisits("prj_1", "a", "b")).rejects.toMatchObject({ status: 400, code: "web_analytics_not_enabled" });
    await expect(api.countVisits("prj_1", "a", "b")).rejects.toBeInstanceOf(VercelApiError);
  });

  it("vercelAnalyticsFromEnv throws while either env var is unset — the lazy-construction contract", () => {
    vi.stubEnv("VERCEL_API_TOKEN", "");
    vi.stubEnv("VERCEL_TEAM_ID", "team_1");
    expect(() => vercelAnalyticsFromEnv()).toThrow(/VERCEL_API_TOKEN/);
    vi.unstubAllEnvs();
  });
});
