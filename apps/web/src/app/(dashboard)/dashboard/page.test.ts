import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

/**
 * F-055 (now half): this page used to query `opportunities` directly
 * (`.select("monetary_value").eq("status", "open")`), which PostgREST caps
 * at `max_rows` (1000) — silently undercounting both the agency-wide "Open
 * opportunities" count and the "Pipeline value" sum above that. It now goes
 * through `sumOpenOpportunities` (packages/db/src/opportunities.ts), which
 * pages past the cap; this test pins that the KPI tiles render exactly what
 * that call returned, and that a failure there degrades to "unavailable"
 * rather than crashing the page or silently showing zero.
 */

vi.mock("@/lib/auth", () => ({
  requireAgency: async () => ({ userId: "user_1" }),
}));

const dbMocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  sumOpenOpportunities: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      if (table === "contacts") {
        return { select: async () => ({ count: 3, error: null }) };
      }
      throw new Error(`unexpected table in agency dashboard page.test.ts mock: ${table}`);
    },
  }),
  listAccounts: (...a: unknown[]) => dbMocks.listAccounts(...a),
  sumOpenOpportunities: (...a: unknown[]) => dbMocks.sumOpenOpportunities(...a),
}));

const { default: DashboardPage } = await import("./page");

function resetFixtures() {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listAccounts.mockResolvedValue([]);
  dbMocks.sumOpenOpportunities.mockResolvedValue({ count: 0, value: 0 });
}

describe("Agency home DashboardPage — open opportunities and pipeline value (F-055 now-half)", () => {
  beforeEach(resetFixtures);

  it("renders the count and currency-formatted sum sumOpenOpportunities returned, agency-wide (no accountId)", async () => {
    dbMocks.sumOpenOpportunities.mockResolvedValue({ count: 1234, value: 987654 });

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain(">1234<");
    expect(html).toContain("$987,654");
    // Agency-wide: called with no account filter.
    expect(dbMocks.sumOpenOpportunities).toHaveBeenCalledWith(expect.anything());
    expect(dbMocks.sumOpenOpportunities.mock.calls[0]).toHaveLength(1);
  });

  it("shows 'unavailable' rather than crashing or showing zero when the query fails", async () => {
    dbMocks.sumOpenOpportunities.mockRejectedValue(new Error("boom"));

    const html = renderToStaticMarkup(await DashboardPage());

    // Both the open-opportunities count AND the pipeline-value sum degrade
    // to the shared "unavailable" marker — neither one is allowed to read
    // as a real zero.
    expect(html.match(new RegExp(m["common.unavailable"], "g"))).toHaveLength(2);
    expect(html).not.toContain("$0<");
  });
});
