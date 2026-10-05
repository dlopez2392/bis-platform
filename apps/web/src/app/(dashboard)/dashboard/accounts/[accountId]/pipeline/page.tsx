import { ensureDefaultPipeline, listBoard, listContacts } from "@bis/db";
import { moveOppToStageAction, updateOpportunityAction, createOpportunityAction } from "./actions";
import { PipelineBoard } from "./pipeline-board";
import { AddOpportunityDialog } from "./add-opportunity-dialog";
import { PageHeader } from "@/components/page-header";
import { dbForRequest } from "@/lib/db";
import { formatCurrency, contactDisplayName } from "@/lib/format";
import { pipelineOpenTotals } from "@/lib/pipeline/totals";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const db = await dbForRequest();
  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const [board, contacts] = await Promise.all([
    listBoard(db, accountId, pipelineId),
    listContacts(db, accountId, { limit: 200 }),
  ]);

  // The board itself still shows every stage's own total (won + lost
  // included — a closed deal must still show where it closed), but this
  // header figure is "what's in the pipeline": the same one definition
  // (open only) the account dashboard's "Pipeline value" tile uses, so the
  // two numbers never disagree again.
  const { count, value: total } = pipelineOpenTotals(board);

  const boundCreate = createOpportunityAction.bind(null, accountId);
  const boundMove = moveOppToStageAction.bind(null, accountId);
  const boundUpdate = updateOpportunityAction.bind(null, accountId);

  return (
    <>
      <PageHeader
        title={m["pipeline.title"]}
        count={`${count} · ${formatCurrency(total)}`}
        actions={
          <AddOpportunityDialog
            pipelineId={pipelineId}
            contacts={contacts.map((c) => ({ id: c.id, name: contactDisplayName(c) }))}
            action={boundCreate}
          />
        }
      />
      <div className="p-6">
        <PipelineBoard
          board={board}
          moveAction={boundMove}
          updateAction={boundUpdate}
        />
      </div>
    </>
  );
}
