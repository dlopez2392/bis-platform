import { serviceDb, ensureDefaultPipeline, listBoard, listContacts } from "@bis/db";
import { moveOppToStageAction, updateOpportunityAction, createOpportunityAction } from "./actions";
import { PipelineBoard } from "./pipeline-board";
import { AddOpportunityDialog } from "./add-opportunity-dialog";
import { PageHeader } from "@/components/page-header";
import { formatCurrency, contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const db = serviceDb();
  const { pipelineId } = await ensureDefaultPipeline(db, accountId);
  const [board, contacts] = await Promise.all([
    listBoard(db, accountId, pipelineId),
    listContacts(db, accountId, { limit: 200 }),
  ]);

  const total = board.reduce((s, c) => s + c.totalValue, 0);
  const count = board.reduce((s, c) => s + c.opportunities.length, 0);

  return (
    <>
      <PageHeader
        title={m["pipeline.title"]}
        count={`${count} · ${formatCurrency(total)}`}
        actions={
          <AddOpportunityDialog
            accountId={accountId}
            pipelineId={pipelineId}
            contacts={contacts.map((c) => ({ id: c.id, name: contactDisplayName(c) }))}
            action={createOpportunityAction}
          />
        }
      />
      <div className="p-6">
        <PipelineBoard
          board={board}
          accountId={accountId}
          moveAction={moveOppToStageAction}
          updateAction={updateOpportunityAction}
        />
      </div>
    </>
  );
}
