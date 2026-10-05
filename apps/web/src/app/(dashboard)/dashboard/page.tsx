import { serviceDb, listAccounts, sumOpenOpportunities } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAgency } from "@/lib/auth";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Agency-only: aggregate stats across every account. The parent layout
  // admits clients into the /dashboard tree (for their own account under
  // [accountId]/), so this leaf must guard itself rather than rely solely
  // on that shared choke point.
  await requireAgency();
  const db = serviceDb();
  const [accounts, contactCount, openOpps] = await Promise.all([
    listAccounts(db),
    db.from("contacts").select("id", { count: "exact", head: true }),
    // Pages past PostgREST's row cap (max_rows, 1000) internally, so neither
    // the count nor the sum silently undercounts above it — see
    // sumOpenOpportunities' own comment. No accountId: this tile is
    // agency-wide, across every account.
    sumOpenOpportunities(db).then(
      (result) => ({ result, error: null as Error | null }),
      (error: Error) => ({ result: null, error }),
    ),
  ]);

  if (contactCount.error) {
    console.error("dashboard: contacts count query failed", contactCount.error);
  }
  if (openOpps.error) {
    console.error("dashboard: opportunities query failed", openOpps.error);
  }

  const contactsValue = contactCount.error
    ? m["common.unavailable"]
    : String(contactCount.count ?? 0);

  const openOppsValue = openOpps.error ? m["common.unavailable"] : String(openOpps.result!.count);
  const pipelineValueDisplay = openOpps.error
    ? m["common.unavailable"]
    : formatCurrency(openOpps.result!.value);

  return (
    <>
      <PageHeader title={m["dashboard.title"]} />
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={m["dashboard.companies"]} value={String(accounts.length)} period={m["common.allTime"]} />
        <StatTile label={m["dashboard.contacts"]} value={contactsValue} period={m["common.allTime"]} />
        <StatTile label={m["dashboard.openOpps"]} value={openOppsValue} period={m["common.allTime"]} />
        <StatTile
          label={m["dashboard.pipelineValue"]}
          value={pipelineValueDisplay}
          period={m["common.allTime"]}
        />
      </div>
    </>
  );
}
