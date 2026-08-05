import { Layers } from "lucide-react";
import { serviceDb, listBlueprints } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAgency } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { m } from "@/lib/messages";
import { BlueprintsTable } from "./blueprints-table";

export const dynamic = "force-dynamic";

export default async function BlueprintsPage() {
  // Agency-only: captured blueprints are agency IP, not client data. The
  // parent layout admits clients into the /dashboard tree, so this leaf must
  // guard itself rather than rely solely on that shared choke point.
  await requireAgency();
  const blueprints = await listBlueprints(serviceDb());

  return (
    <>
      <PageHeader title={m["blueprints.title"]} />
      <div className="p-6">
        {blueprints.length === 0 ? (
          <EmptyState icon={Layers} title={m["blueprints.empty.title"]} body={m["blueprints.empty.body"]} />
        ) : (
          <BlueprintsTable
            rows={blueprints.map((b) => ({
              id: b.id, name: b.name, version: b.version,
              captured: formatDateTime(b.created_at), appliedCount: b.appliedCount,
            }))}
          />
        )}
      </div>
    </>
  );
}
