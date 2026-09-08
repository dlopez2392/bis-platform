// Vercel Web Analytics, read-only. Docs: https://vercel.com/docs/analytics/web-analytics-api
// GET /v1/query/web-analytics/visits/count      ?projectId&teamId&since&until[&filter]
// GET /v1/query/web-analytics/visits/aggregate  ?projectId&teamId&since&until&by&limit
//
// Constructed LAZILY by callers (the pass, the link action) — never at module
// scope — so a missing token fails one tick or one click loudly and nothing
// else. Aggregates only: nothing here ever sees a visitor.

export type DimRow = { value: string; visitors: number; pageviews: number };
export type DayTraffic = {
  visitors: number; pageviews: number;
  pages: DimRow[]; sources: DimRow[]; places: DimRow[]; devices: DimRow[];
};

/** Task 1's finding (runbook, Findings): the API groups by country, never by
 *  city or region, so places are stored by country and the Website section
 *  shows a Devices panel in that slot instead. */
export const PLACE_DIMENSION: "city" | "region" | "country" = "country";
export const BREAKDOWN_LIMIT = 20;

const BASE = "https://api.vercel.com/v1/query/web-analytics";

export class VercelApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message);
    this.name = "VercelApiError";
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function parseCount(json: unknown): { visitors: number; pageviews: number } {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  const visitors = num(data?.visitors);
  const pageviews = num(data?.pageviews);
  if (visitors === null || pageviews === null) throw new Error("count response: visitors/pageviews missing");
  return { visitors, pageviews };
}

export function parseAggregate(json: unknown, by: string): DimRow[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) throw new Error(`aggregate response for ${by}: data is not an array`);
  return data.map((raw) => {
    const row = raw as Record<string, unknown>;
    const value = row[by];
    const visitors = num(row.visitors);
    const pageviews = num(row.pageviews) ?? num(row.count);
    if (typeof value !== "string" || visitors === null || pageviews === null) {
      throw new Error(`aggregate response for ${by}: row missing ${by}/visitors/pageviews`);
    }
    return { value, visitors, pageviews };
  });
}

export class VercelAnalytics {
  readonly #token: string;
  readonly #teamId: string;
  readonly #fetch: typeof fetch;

  constructor(opts: { token: string; teamId: string; fetchImpl?: typeof fetch }) {
    this.#token = opts.token;
    this.#teamId = opts.teamId;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async #get(url: URL): Promise<unknown> {
    url.searchParams.set("teamId", this.#teamId);
    const res = await this.#fetch(url.toString(), { headers: { Authorization: `Bearer ${this.#token}` } });
    if (!res.ok) {
      let code: string | null = null;
      let message = `vercel ${url.pathname} ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? null;
        if (body.error?.message) message = body.error.message;
      } catch { /* body was not JSON; keep the status message */ }
      throw new VercelApiError(res.status, code, message);
    }
    return res.json();
  }

  #query(path: string, params: Record<string, string>): URL {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }

  async countVisits(projectId: string, sinceIso: string, untilIso: string) {
    return parseCount(await this.#get(this.#query("visits/count", { projectId, since: sinceIso, until: untilIso })));
  }

  async aggregate(projectId: string, sinceIso: string, untilIso: string, by: string, limit: number): Promise<DimRow[]> {
    return parseAggregate(
      await this.#get(this.#query("visits/aggregate", { projectId, since: sinceIso, until: untilIso, by, limit: String(limit) })),
      by,
    );
  }

  /** The five queries for one local day, in a fixed order (the test pins it). */
  async fetchDayTraffic(projectId: string, sinceIso: string, untilIso: string): Promise<DayTraffic> {
    const totals = await this.countVisits(projectId, sinceIso, untilIso);
    const pages = await this.aggregate(projectId, sinceIso, untilIso, "requestPath", BREAKDOWN_LIMIT);
    const sources = await this.aggregate(projectId, sinceIso, untilIso, "referrerHostname", BREAKDOWN_LIMIT);
    const places = await this.aggregate(projectId, sinceIso, untilIso, PLACE_DIMENSION, BREAKDOWN_LIMIT);
    const devices = await this.aggregate(projectId, sinceIso, untilIso, "deviceType", BREAKDOWN_LIMIT);
    return { ...totals, pages, sources, places, devices };
  }

  /** The team's projects, for the link card's picker: id, name, and the
   *  production domain when one is aliased (the first non-vercel.app alias). */
  async listProjects(): Promise<{ id: string; name: string; domain: string | null }[]> {
    const url = new URL("https://api.vercel.com/v9/projects");
    url.searchParams.set("limit", "100");
    const body = (await this.#get(url)) as { projects?: { id: string; name: string; targets?: { production?: { alias?: string[] } } }[] };
    return (body.projects ?? []).map((p) => {
      const aliases = p.targets?.production?.alias ?? [];
      const domain = aliases.find((a) => !a.endsWith(".vercel.app")) ?? aliases[0] ?? null;
      return { id: p.id, name: p.name, domain };
    });
  }
}

export function vercelAnalyticsFromEnv(): VercelAnalytics {
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !teamId) throw new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset");
  return new VercelAnalytics({ token, teamId });
}
