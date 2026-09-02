import Link from "next/link";
import { ListChecks } from "lucide-react";
import { listChecklistState, countFormsMissingNotify } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
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
  // Authorization already happened in [accountId]/layout.tsx; this call is
  // only to learn the role for rendering — the activation checklist is the
  // agency's onboarding worklist about the client, not client data (spec §6.1).
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
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
    throw new Error(`account dashboard: contacts count query failed: ${contacts.error.message}`);
  }
  if (opps.error) {
    throw new Error(`account dashboard: opportunities query failed: ${opps.error.message}`);
  }

  const contactsValue = String(contacts.count ?? 0);

  const open = opps.data ?? [];
  const value = open.reduce((sum, o) => sum + Number(o.monetary_value), 0);
  const openOppsValue = String(open.length);
  const pipelineValueDisplay = formatCurrency(value);

  const checklistEntries = mergeChecklist(checklistRows);
  const checklistRemaining = checklistEntries.filter((e) => !e.done).length;

  return (
    <>
      <PageHeader title={m["account.dashboard.title"]} />
      <div className="space-y-6 p-6">
        {isAgency ? (
          checklistRemaining > 0 ? (
            <div className="max-w-2xl">
              <ChecklistPanel
                entries={checklistEntries}
                formsMissingNotify={formsMissingNotify}
                setAction={setChecklistItemAction.bind(null, accountId)}
                addAction={addChecklistItemAction.bind(null, accountId)}
                titleHref={`/dashboard/accounts/${accountId}/checklist`}
              />
            </div>
          ) : (
            // A finished checklist should not compete with the rest of the
            // dashboard, but it still has to stay reachable — un-ticking an
            // item, adding a custom step, or just reviewing what was done had
            // no path back in once the panel above stopped rendering.
            <Link
              href={`/dashboard/accounts/${accountId}/checklist`}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ListChecks className="size-3.5" aria-hidden />
              {m["checklist.reviewLink"]}
            </Link>
          )
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label={m["account.contacts"]} value={contactsValue} period={m["common.allTime"]} />
          <StatTile label={m["account.openOpps"]} value={openOppsValue} period={m["common.allTime"]} />
          <StatTile
            label={m["account.pipelineValue"]}
            value={pipelineValueDisplay}
            period={m["common.allTime"]}
          />
        </div>
      </div>
    </>
  );
}
