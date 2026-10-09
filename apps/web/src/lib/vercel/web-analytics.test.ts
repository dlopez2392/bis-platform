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

  it("aggregate passes by and limit, and fetchDayTraffic makes exactly five aggregate calls in a fixed order — totals included, since the count endpoint floors to UTC midnight (D-053)", async () => {
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
    expect(bys).toEqual(["environment", "requestPath", "referrerHostname", "country", "deviceType"]);
    expect(new URL(f.mock.calls[0]![0] as string).searchParams.get("limit")).toBe("1");
    expect(new URL(f.mock.calls[1]![0] as string).searchParams.get("limit")).toBe("20");
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

  // The coordinator's fail-soft ask: the `environment` total call is an
  // unverified API shape, so a rejection or an unexpected row count must
  // fall back to the old `visits/count` total for that one day — never
  // fail the day outright — and say so in one log line with no secrets.
  describe("fetchDayTraffic's total falls back to visits/count when the environment aggregate doesn't come back as expected", () => {
    function routedFetch(envBody: { ok: boolean; status?: number; json: unknown }) {
      return vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith("visits/count")) {
          return { ok: true, status: 200, json: async () => COUNT_JSON, text: async () => "" };
        }
        const by = u.searchParams.get("by");
        if (by === "environment") {
          return { ok: envBody.ok, status: envBody.status ?? (envBody.ok ? 200 : 500), json: async () => envBody.json, text: async () => JSON.stringify(envBody.json) };
        }
        return { ok: true, status: 200, json: async () => ({ data: [{ [by!]: "/", visitors: 1, pageviews: 2 }] }), text: async () => "" };
      });
    }

    // Mutation: drop the try/catch around the environment aggregate call —
    // this throws out of fetchDayTraffic instead of falling back.
    it("(a) the environment aggregate call rejects (500) -> falls back to count, day still written", async () => {
      const f = routedFetch({ ok: false, status: 500, json: { error: { message: "boom" } } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980); // COUNT_JSON's value, not the failed aggregate's
      expect(day.pageviews).toBe(1250);
      expect(day.pages).toHaveLength(1); // breakdowns still ran
      expect(errSpy).toHaveBeenCalledTimes(1);
      const line = errSpy.mock.calls[0]![0] as string;
      expect(line).toMatch(/fell back to visits\/count/);
      expect(line).not.toContain("tok"); // no secrets
      errSpy.mockRestore();
    });

    // Mutation: change `rows.length === 1` to `rows.length >= 0` — zero and
    // two-row cases stop falling back and read `undefined` as 0/0.
    it("(b) zero rows from the environment aggregate -> falls back to count", async () => {
      const f = routedFetch({ ok: true, json: { data: [] } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980);
      expect(errSpy.mock.calls[0]![0]).toMatch(/fell back to visits\/count/);
      errSpy.mockRestore();
    });

    it("(b) two rows from the environment aggregate -> falls back to count", async () => {
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

    it("(b) a row missing `visitors` from the environment aggregate -> parseAggregate rejects -> falls back to count", async () => {
      const f = routedFetch({ ok: true, json: { data: [{ environment: "production", pageviews: 1250 }] } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
      const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
      expect(day.visitors).toBe(980);
      expect(errSpy.mock.calls[0]![0]).toMatch(/fell back to visits\/count/);
      errSpy.mockRestore();
    });

    // (c) happy path: the five-call test above already asserts exactly 5
    // fetch calls for a well-formed response, which is only true when the
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
