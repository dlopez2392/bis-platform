import type { Proposal } from "@bis/db/proposal-rules";
import type { Db } from "./kinds/types";
import type { SuggestionViewCtx } from "./view";

/**
 * The stage names a screen's suggestions need (item 8b-1, plan fix I-5), shared by the call page and the
 * To do tray: the deals behind the stage suggestions (their `pipeline_id`), then the WHOLE stage list of
 * those pipelines, for `describe`'s names and positions and Edit's choices. Both reads run on the request
 * client the page passes in, carry the account's own filter (RLS does not backstop them: an agency
 * session reads every tenant's rows) and are bounded. A failed read throws: the caller puts its section
 * into the error state, never a card it cannot name.
 */
export type StageContext = Pick<SuggestionViewCtx, "stages" | "pipelineStages">;

const NONE: StageContext = { stages: {}, pipelineStages: [] };

export async function readSuggestionStages(db: Db, accountId: string, rows: readonly Proposal[]): Promise<StageContext> {
  const dealIds = [...new Set(rows.flatMap((r) => (r.kind === "opportunity_stage" ? [r.payload.opportunityId] : [])))];
  if (dealIds.length === 0) return NONE;

  const deals = await db.from("opportunities").select("id, pipeline_id")
    .eq("account_id", accountId).in("id", dealIds).limit(dealIds.length);
  if (deals.error) throw new Error(`suggestion deals read failed: ${deals.error.message}`);
  const pipelineIds = [...new Set(((deals.data ?? []) as { pipeline_id: string }[]).map((d) => d.pipeline_id))];
  if (pipelineIds.length === 0) return NONE;

  const read = await db.from("pipeline_stages").select("id, name, position, pipeline_id")
    .eq("account_id", accountId).in("pipeline_id", pipelineIds).limit(500);
  if (read.error) throw new Error(`suggestion stages read failed: ${read.error.message}`);
  const rowsRead = (read.data ?? []) as { id: string; name: string; position: number; pipeline_id: string }[];

  const stages: Record<string, { name: string; position: number }> = {};
  for (const s of rowsRead) stages[s.id] = { name: s.name, position: s.position };
  return {
    stages,
    pipelineStages: rowsRead.map((s) => ({ id: s.id, name: s.name, position: s.position, pipelineId: s.pipeline_id })),
  };
}
