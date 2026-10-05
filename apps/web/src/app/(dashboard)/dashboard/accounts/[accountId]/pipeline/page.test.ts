import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { formatCurrency } from "@/lib/format";

/**
 * The header's one number used to disagree with the account dashboard's
 * "Pipeline value" tile two different ways: it summed `totalValue` across
 * every stage (open + won + lost, not open only), AND it derived that sum
 * from `listBoard` — which reads only the ONE default pipeline, unpaged, so
 * a second pipeline or >1,000 open deals would still disagree with the
 * dashboard tile even after filtering by status. The fix calls
 * `sumOpenOpportunities` directly — the exact same call the dashboard tile
 * makes — so this test deliberately gives the board a DIFFERENT set of
 * numbers than the mocked `sumOpenOpportunities` result: if the header ever
 * goes back to deriving from `board`, it would show the board's numbers
 * instead, and this test would catch it.
 */

vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({}),
}));

const boardFixture = vi.hoisted(() => ({
  board: [] as Array<{
    stage: { id: string; name: string; position: number };
    totalValue: number;
    opportunities: Array<{ id: string; name: string; monetary_value: number; status: string;
      contact: { id: string; first_name: string | null; last_name: string | null } }>;
  }>,
}));

const sumOpenOpportunitiesMock = vi.hoisted(() => vi.fn());

vi.mock("@bis/db", () => ({
  ensureDefaultPipeline: async () => ({ pipelineId: "pipe1" }),
  listBoard: async () => boardFixture.board,
  listContacts: async () => [],
  sumOpenOpportunities: (...a: unknown[]) => sumOpenOpportunitiesMock(...a),
  // Unused by this test (never called — these only back the bound server
  // actions passed down as props), but actions.ts imports them from here.
  createOpportunity: vi.fn(),
  moveOpportunityToStage: vi.fn(),
  updateOpportunity: vi.fn(),
}));

vi.mock("./pipeline-board", () => ({ PipelineBoard: () => null }));
vi.mock("./add-opportunity-dialog", () => ({ AddOpportunityDialog: () => null }));

const { default: PipelinePage } = await import("./page");

function route(accountId = "acct1") {
  return { params: Promise.resolve({ accountId }) };
}

function opp(id: string, value: number, status: string) {
  return { id, name: id, monetary_value: value, status,
    contact: { id: "c1", first_name: "A", last_name: "B" } };
}

describe("PipelinePage header total", () => {
  it("renders sumOpenOpportunities' own count/value, not a figure derived from the board", async () => {
    // The board disagrees on purpose: 2 open deals worth $500 total here —
    // but sumOpenOpportunities (a second pipeline, or rows past this
    // board's reach) says 9 deals worth $9,999. If the header were still
    // reading the board, it would show "2 open · $500".
    boardFixture.board = [
      {
        stage: { id: "s1", name: "New Lead", position: 0 },
        totalValue: 900,
        opportunities: [opp("a", 400, "open"), opp("b", 500, "won")],
      },
      {
        stage: { id: "s3", name: "Proposal", position: 2 },
        totalValue: 100,
        opportunities: [opp("d", 100, "open")],
      },
    ];
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 9, value: 9999 });

    const html = renderToStaticMarkup(await PipelinePage(route()));

    expect(html).toContain(`9 open · ${formatCurrency(9999)}`);
    // The board's own (wrong) figure must not leak through instead.
    expect(html).not.toContain(`2 open · ${formatCurrency(500)}`);
  });

  it("says 'open' plainly — the landscaper read, not the bare 'N · $X' the per-column subtotals use", async () => {
    boardFixture.board = [];
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 2, value: 500 });

    const html = renderToStaticMarkup(await PipelinePage(route()));

    expect(html).toContain(`2 open · ${formatCurrency(500)}`);
  });

  it("scopes the call to this account", async () => {
    sumOpenOpportunitiesMock.mockReset();
    sumOpenOpportunitiesMock.mockResolvedValue({ count: 0, value: 0 });

    await PipelinePage(route("acct_specific"));

    expect(sumOpenOpportunitiesMock).toHaveBeenCalledWith(expect.anything(), "acct_specific");
  });
});
