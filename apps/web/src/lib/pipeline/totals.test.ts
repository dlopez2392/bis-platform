import { describe, it, expect } from "vitest";
import { pipelineOpenTotals } from "./totals";

/**
 * The board shows every opportunity on every stage, including ones already
 * marked won or lost (so a closed deal still shows where it closed). The
 * header total must not silently roll won/lost value back in: it is meant
 * to answer "what's still in the pipeline", the same question the account
 * dashboard's "Pipeline value" tile answers, and the two used to disagree
 * because one counted every status and the other counted "open" only.
 */
describe("pipelineOpenTotals", () => {
  it("counts and sums only status: open opportunities across every stage", () => {
    const board = [
      {
        totalValue: 900,
        opportunities: [
          { monetary_value: 400, status: "open" },
          { monetary_value: 500, status: "won" },
        ],
      },
      {
        totalValue: 300,
        opportunities: [
          { monetary_value: 300, status: "lost" },
        ],
      },
      {
        totalValue: 100,
        opportunities: [
          { monetary_value: 100, status: "open" },
        ],
      },
    ];

    expect(pipelineOpenTotals(board)).toEqual({ count: 2, value: 500 });
  });

  it("is zero on an empty board", () => {
    expect(pipelineOpenTotals([])).toEqual({ count: 0, value: 0 });
  });
});
