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
    db.from("opportunities").select("monetary_value").eq("status", "open"),
  ]);

  const opps = openOpps.data ?? [];
  const pipelineValue = opps.reduce((sum, o) => sum + Number(o.monetary_value), 0);

  return (
    <>
      <PageHeader title={m["dashboard.title"]} />
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={m["dashboard.companies"]} value={String(accounts.length)} />
        <StatTile label={m["dashboard.contacts"]} value={String(contactCount.count ?? 0)} />
        <StatTile label={m["dashboard.openOpps"]} value={String(opps.length)} />
        <StatTile label={m["dashboard.pipelineValue"]} value={formatCurrency(pipelineValue)} />
      </div>
    </>
  );
}
