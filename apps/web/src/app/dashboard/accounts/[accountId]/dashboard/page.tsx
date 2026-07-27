import { serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function AccountDashboardPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const db = serviceDb();
  const [contacts, opps] = await Promise.all([
    db.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    db
      .from("opportunities")
      .select("monetary_value")
      .eq("account_id", accountId)
      .eq("status", "open"),
  ]);

  const open = opps.data ?? [];
  const value = open.reduce((sum, o) => sum + Number(o.monetary_value), 0);

  return (
    <>
      <PageHeader title={m["account.dashboard.title"]} />
      <div className="grid gap-4 p-6 sm:grid-cols-3">
        <StatTile label={m["account.contacts"]} value={String(contacts.count ?? 0)} />
        <StatTile label={m["account.openOpps"]} value={String(open.length)} />
        <StatTile label={m["account.pipelineValue"]} value={formatCurrency(value)} />
      </div>
    </>
  );
}
