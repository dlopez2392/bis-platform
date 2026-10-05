/**
 * `listBoard` groups EVERY opportunity by stage, including ones already
 * marked won or lost — the kanban still needs to show a closed deal where
 * it closed. The page header's total used to sum `col.totalValue` straight
 * off that same structure, which silently rolled won/lost value back into
 * "what's in the pipeline" — a second, disagreeing definition of pipeline
 * value next to the account dashboard's "Pipeline value" tile, which has
 * always counted open deals only. This is the one definition both now
 * share.
 */
export interface PipelineBoardOpportunity {
  monetary_value: number;
  status: string;
}

export interface PipelineBoardColumn {
  totalValue: number;
  opportunities: PipelineBoardOpportunity[];
}

export function pipelineOpenTotals(
  board: PipelineBoardColumn[],
): { count: number; value: number } {
  let count = 0;
  let value = 0;
  for (const column of board) {
    for (const opp of column.opportunities) {
      if (opp.status === "open") {
        count += 1;
        value += opp.monetary_value;
      }
    }
  }
  return { count, value };
}
