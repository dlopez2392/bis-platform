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
/** Past `limit` the API folds the tail into ONE row with this value
 *  (docs: "groups the remaining values into Others"). It is not a page, a
 *  place or a source, and the count query already carries the true total. */
export const OTHERS_ROLLUP = "Others";
/**
 * Applied to `aggregate()` ONLY, never to `countVisits()`. Count endpoints
 * are documented as production-only; aggregate endpoints are not, so this
 * is what keeps every breakdown — and now the total too (see
 * `TOTAL_GROUPING` below) — on the same environment footing.
 *
 * D-053's REAL cause, per live probing (runbook, website-setup.md's
 * "First-night findings", 2026-09-08): `visits/count` floors `since` and
 * `until` DOWN to UTC midnight (so a local-day window is answered for the
 * UTC day instead), while `visits/aggregate` honours `since` to the hour
 * but treats `until` as INCLUSIVE of its bucket (echoed back +1h) — so
 * within one stored day, the total covered the UTC day and every
 * breakdown covered local midnight through local midnight plus one hour.
 * Two different WINDOWS under one "day" label, not two different
 * environments; adding this filter to `countVisits()` (tried, reverted)
 * would not have touched that mismatch at all.
 *
 * DECIDED 2026-10-09 (D-053, danlo): local day, for both totals and
 * breakdowns. `fetchDayTraffic` no longer calls `countVisits()` at all —
 * the total is now ANOTHER `aggregate()` call (`TOTAL_GROUPING`), on the
 * exact same `[since, until)` window every breakdown uses, so there is
 * only ever one window per stored day, not two. The `until`-inclusive
 * quirk is compensated inside `aggregate()` itself (`exclusiveUntil`),
 * so every caller — the total and all four breakdowns — gets a window
 * that closes exactly at the `until` it was given. `countVisits()` is
 * unchanged and still used only by the Test Connection probe
 * (`website/actions.ts`), which is a rough last-7-days sanity check, not
 * a stored day — its UTC-floor and inclusive-until are both irrelevant
 * there.
 */
export const PRODUCTION_FILTER = "environment eq 'production'";

/**
 * D-053: the local-day TOTAL, sourced from `aggregate()` instead of
 * `visits/count`, because `aggregate()` honours `since`/`until` to the
 * hour (once `exclusiveUntil` below removes its own quirk) while `count`
 * floors both to UTC midnight. Grouping by `environment` — already the
 * ONLY value `PRODUCTION_FILTER` admits into any aggregate response —
 * turns "group by" into ordinary set arithmetic: one group, one row, and
 * that row's `visitors`/`pageviews` ARE the window's un-split totals (not
 * a sum across rows, which would be exact for pageviews but not for
 * visitors — the problem the runbook's "Decision owed" named and this
 * sidesteps rather than solves). `limit` is 1 because the filter already
 * guarantees at most one row.
 *
 * ASSUMPTION (not verified live from this sandbox — the token here is
 * production-only and unreachable): that `by=environment&limit=1` is
 * accepted and returns that single row. `environment` is one of the
 * runbook's own confirmed allowed groupings (Part A's Findings), and the
 * single-row shape follows from group-by semantics once the filter has
 * already excluded every other value — nothing here is a NEW claim about
 * the API past what the runbook already proved live.
 */
const TOTAL_GROUPING = "environment";
const TOTAL_LIMIT = 1;

/**
 * D-053: Vercel's aggregate endpoint treats `until` as INCLUSIVE of its
 * hour bucket (echoed back +1h — runbook's "First-night findings",
 * verified live on 2026-09-08). Subtracting one hour before sending makes
 * the ACTUAL window close exactly at the caller's `until`, matching the
 * half-open `[since, until)` `localDayBounds` already builds. A flat
 * millisecond subtraction on the absolute instant, not a local-time one,
 * so it is correct on a DST transition day the same as any other —
 * `localDayBounds` already resolves each day's real local midnight
 * independently, so the 1-hour Vercel-bucket compensation here never
 * needs to know the local offset at all.
 */
function exclusiveUntil(untilIso: string): string {
  return new Date(new Date(untilIso).getTime() - 60 * 60 * 1000).toISOString();
}

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
  const rows: DimRow[] = [];
  for (const raw of data) {
    const row = raw as Record<string, unknown>;
    // What a direct visit carries as referrerHostname is documented nowhere.
    // A null/absent value becomes "" (channelOf reads that as Direct) rather
    // than failing the whole day for every day that has one.
    const value = row[by] == null ? "" : row[by];
    const visitors = num(row.visitors);
    const pageviews = num(row.pageviews) ?? num(row.count);
    if (typeof value !== "string" || visitors === null || pageviews === null) {
      throw new Error(`aggregate response for ${by}: row missing ${by}/visitors/pageviews`);
    }
    if (value === OTHERS_ROLLUP) continue;
    rows.push({ value, visitors, pageviews });
  }
  return rows;
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
      await this.#get(this.#query("visits/aggregate", { projectId, since: sinceIso, until: exclusiveUntil(untilIso), by, limit: String(limit), filter: PRODUCTION_FILTER })),
      by,
    );
  }

  /**
   * The local-day total, via the `TOTAL_GROUPING` aggregate call, with a
   * SOFT fallback to the old `visits/count` (UTC-day) total when that call
   * doesn't come back the one way it's expected to: a reject (bad request,
   * network error, or `parseAggregate` refusing a malformed row), or a
   * resolved response whose row count isn't exactly 1 (Vercel's shape
   * contract here — one grouped value, because `PRODUCTION_FILTER` admits
   * only one — is unverified live from this sandbox; see `TOTAL_GROUPING`'s
   * doc). This call failing must never fail the whole day: a day with a
   * degraded total (the old UTC-window number, for this one day only) is
   * still written; a day with NO total at all is a hole the next tick has
   * to retry forever. One log line names the fallback and why, with no
   * token or other secret in it (both failure paths' messages come from
   * `VercelApiError`/`parseAggregate`, which only ever carry Vercel's own
   * status/error text or a field name — never the request itself).
   */
  async #dayTotal(projectId: string, sinceIso: string, untilIso: string): Promise<{ visitors: number; pageviews: number }> {
    try {
      const rows = await this.aggregate(projectId, sinceIso, untilIso, TOTAL_GROUPING, TOTAL_LIMIT);
      if (rows.length === 1) return { visitors: rows[0]!.visitors, pageviews: rows[0]!.pageviews };
      console.error(`site traffic: local-day total for project ${projectId} fell back to visits/count — the ${TOTAL_GROUPING} aggregate returned ${rows.length} row(s), expected 1`);
    } catch (e) {
      console.error(`site traffic: local-day total for project ${projectId} fell back to visits/count — the ${TOTAL_GROUPING} aggregate failed: ${String(e)}`);
    }
    return this.countVisits(projectId, sinceIso, untilIso);
  }

  /** The five queries for one local day, in a fixed order (the test pins
   *  it) — all five through `aggregate()` in the ordinary case (D-053), so
   *  all five share one window and one environment filter; `countVisits()`
   *  is called here ONLY as `#dayTotal`'s fallback. */
  async fetchDayTraffic(projectId: string, sinceIso: string, untilIso: string): Promise<DayTraffic> {
    const totals = await this.#dayTotal(projectId, sinceIso, untilIso);
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
