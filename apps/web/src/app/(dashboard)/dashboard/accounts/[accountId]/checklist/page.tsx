import { serviceDb, listChecklistState, countFormsMissingNotify } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { m } from "@/lib/messages";
import { ChecklistPanel } from "./checklist-panel";
import { setChecklistItemAction, addChecklistItemAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = serviceDb();
  const [rows, formsMissingNotify] = await Promise.all([
    listChecklistState(db, accountId),
    countFormsMissingNotify(db, accountId),
  ]);
  return (
    <>
      <PageHeader title={m["checklist.title"]} />
      <div className="max-w-2xl p-6">
        <ChecklistPanel
          entries={mergeChecklist(rows)}
          formsMissingNotify={formsMissingNotify}
          setAction={setChecklistItemAction.bind(null, accountId)}
          addAction={addChecklistItemAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
