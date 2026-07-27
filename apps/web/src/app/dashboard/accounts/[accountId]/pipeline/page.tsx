import { serviceDb, ensureDefaultPipeline, listBoard } from "@bis/db";
import { moveOppToStageAction } from "./actions";
import { PipelineBoard } from "./pipeline-board";
import { PageHeader } from "@/components/page-header";
import { formatCurrency } from "@/lib/format";
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
  const board = await listBoard(db, accountId, pipelineId);

  const total = board.reduce((s, c) => s + c.totalValue, 0);
  const count = board.reduce((s, c) => s + c.opportunities.length, 0);

  return (
    <>
      <PageHeader title={m["pipeline.title"]} count={`${count} · ${formatCurrency(total)}`} />
      <div className="p-6">
        <PipelineBoard board={board} accountId={accountId} moveAction={moveOppToStageAction} />
      </div>
    </>
  );
}
