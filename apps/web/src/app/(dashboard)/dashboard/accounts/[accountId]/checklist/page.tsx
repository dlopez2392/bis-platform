import { listChecklistState, countFormsMissingNotify } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { m } from "@/lib/messages";
import { ChecklistPanel } from "./checklist-panel";
import { setChecklistItemAction, addChecklistItemAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ apply?: string }>;
}) {
  const { accountId } = await params;
  const { apply } = await searchParams;
  await requireAgencyOnlyAccountAccess(accountId);
  const db = await dbForRequest();
  const [rows, formsMissingNotify] = await Promise.all([
    listChecklistState(db, accountId),
    countFormsMissingNotify(db, accountId),
  ]);
  return (
    <>
      <PageHeader title={m["checklist.title"]} />
      <div className="max-w-2xl space-y-4 p-6">
        {apply === "partial" ? (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {m["accounts.blueprintPartial"]}
          </p>
        ) : null}
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
