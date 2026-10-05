import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatCurrency } from "@/lib/format";

/**
 * The header's one number used to disagree with the account dashboard's
 * "Pipeline value" tile: this page summed `totalValue` across every stage
 * (open + won + lost), the dashboard counted "open" only. Real DB entry
 * points are mocked (same shape as calls/page.test.ts) so the header's own
 * arithmetic — not `listBoard`'s grouping, which opportunities.test.ts
 * already covers — is what's under test. The board/dialog sub-components
 * are stubbed out entirely: their own markup is each one's own test's job.
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

vi.mock("@bis/db", () => ({
  ensureDefaultPipeline: async () => ({ pipelineId: "pipe1" }),
  listBoard: async () => boardFixture.board,
  listContacts: async () => [],
  // Unused by this test (never called — these only back the bound server
  // actions passed down as props), but actions.ts imports them from here.
  createOpportunity: vi.fn(),
  moveOpportunityToStage: vi.fn(),
  updateOpportunity: vi.fn(),
}));

vi.mock("./pipeline-board", () => ({ PipelineBoard: () => null }));
vi.mock("./add-opportunity-dialog", () => ({ AddOpportunityDialog: () => null }));

const { default: PipelinePage } = await import("./page");

function route() {
  return { params: Promise.resolve({ accountId: "acct1" }) };
}

function opp(id: string, value: number, status: string) {
  return { id, name: id, monetary_value: value, status,
    contact: { id: "c1", first_name: "A", last_name: "B" } };
}

describe("PipelinePage header total", () => {
  it("counts and sums open opportunities only, even with won/lost cards on the board", async () => {
    boardFixture.board = [
      {
        stage: { id: "s1", name: "New Lead", position: 0 },
        totalValue: 900, // the stage's OWN total — all statuses; untouched by this fix
        opportunities: [opp("a", 400, "open"), opp("b", 500, "won")],
      },
      {
        stage: { id: "s2", name: "Closed", position: 1 },
        totalValue: 300,
        opportunities: [opp("c", 300, "lost")],
      },
      {
        stage: { id: "s3", name: "Proposal", position: 2 },
        totalValue: 100,
        opportunities: [opp("d", 100, "open")],
      },
    ];

    const html = renderToStaticMarkup(await PipelinePage(route()));

    // Open-only: a (400, open) + d (100, open) = 2 deals, $500 — NOT the
    // 4-deal / $1300 figure summing every status on the board.
    expect(html).toContain(`2 · ${formatCurrency(500)}`);
    expect(html).not.toContain(`4 · ${formatCurrency(1300)}`);
  });
});
