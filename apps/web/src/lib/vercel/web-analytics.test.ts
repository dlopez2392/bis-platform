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

  it("aggregate passes by and limit, and fetchDayTraffic makes exactly five calls in a fixed order", async () => {
    // Rows are keyed by whichever dimension the call asked for — the real
    // API's shape — so the referrerHostname/country/deviceType parses succeed.
    const f = vi.fn(async (url: string) => {
      const by = new URL(url).searchParams.get("by");
      const body = by === null ? COUNT_JSON : { version: 1, query: { groupBy: [by] }, data: [
        { [by]: "/", pageviews: 400, visitors: 300 }, { [by]: "/services", count: 120, visitors: 90 },
      ] };
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
    expect(f).toHaveBeenCalledTimes(5);
    const bys = f.mock.calls.map(([u]) => new URL(u as string).searchParams.get("by")).filter(Boolean);
    expect(bys).toEqual(["requestPath", "referrerHostname", "country", "deviceType"]);
    expect(new URL(f.mock.calls[1]![0] as string).searchParams.get("limit")).toBe("20");
    expect(day.visitors).toBe(980);
    expect(day.pages).toHaveLength(2);
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
