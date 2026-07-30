import { serviceDb, listAccounts } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = serviceDb();
  const [accounts, contactCount, openOpps] = await Promise.all([
    listAccounts(db),
    db.from("contacts").select("id", { count: "exact", head: true }),
    // PostgREST caps rows at max_rows (1000). Above that, this sum and count
    // silently undercount — an accurate figure needs a DB-side aggregate.
    db.from("opportunities").select("monetary_value").eq("status", "open"),
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

  const opps = openOpps.data ?? [];
  const pipelineValue = opps.reduce((sum, o) => sum + Number(o.monetary_value), 0);
  const openOppsValue = openOpps.error ? m["common.unavailable"] : String(opps.length);
  const pipelineValueDisplay = openOpps.error
    ? m["common.unavailable"]
    : formatCurrency(pipelineValue);

  return (
    <>
      <PageHeader title={m["dashboard.title"]} />
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={m["dashboard.companies"]} value={String(accounts.length)} />
        <StatTile label={m["dashboard.contacts"]} value={contactsValue} />
        <StatTile label={m["dashboard.openOpps"]} value={openOppsValue} />
        <StatTile label={m["dashboard.pipelineValue"]} value={pipelineValueDisplay} />
      </div>
    </>
  );
}
