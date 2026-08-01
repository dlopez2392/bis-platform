import { serviceDb, listChecklistState, countFormsMissingNotify } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { formatCurrency } from "@/lib/format";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { m } from "@/lib/messages";
import { ChecklistPanel } from "../checklist/checklist-panel";
import { setChecklistItemAction, addChecklistItemAction } from "../checklist/actions";

export const dynamic = "force-dynamic";

export default async function AccountDashboardPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const db = serviceDb();
  const [contacts, opps, checklistRows, formsMissingNotify] = await Promise.all([
    db.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    // PostgREST caps rows at max_rows (1000). Above that, this sum and count
    // silently undercount — an accurate figure needs a DB-side aggregate.
    db
      .from("opportunities")
      .select("monetary_value")
      .eq("account_id", accountId)
      .eq("status", "open"),
    listChecklistState(db, accountId),
    countFormsMissingNotify(db, accountId),
  ]);

  if (contacts.error) {
    console.error("account dashboard: contacts count query failed", contacts.error);
  }
  if (opps.error) {
    console.error("account dashboard: opportunities query failed", opps.error);
  }

  const contactsValue = contacts.error
    ? m["common.unavailable"]
    : String(contacts.count ?? 0);

  const open = opps.data ?? [];
  const value = open.reduce((sum, o) => sum + Number(o.monetary_value), 0);
  const openOppsValue = opps.error ? m["common.unavailable"] : String(open.length);
  const pipelineValueDisplay = opps.error
    ? m["common.unavailable"]
    : formatCurrency(value);

  const checklistEntries = mergeChecklist(checklistRows);
  const checklistRemaining = checklistEntries.filter((e) => !e.done).length;

  return (
    <>
      <PageHeader title={m["account.dashboard.title"]} />
      <div className="space-y-6 p-6">
        {checklistRemaining > 0 ? (
          <div className="max-w-2xl">
            <ChecklistPanel
              entries={checklistEntries}
              formsMissingNotify={formsMissingNotify}
              setAction={setChecklistItemAction.bind(null, accountId)}
              addAction={addChecklistItemAction.bind(null, accountId)}
            />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label={m["account.contacts"]} value={contactsValue} />
          <StatTile label={m["account.openOpps"]} value={openOppsValue} />
          <StatTile label={m["account.pipelineValue"]} value={pipelineValueDisplay} />
        </div>
      </div>
    </>
  );
}
