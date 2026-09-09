import Link from "next/link";
import { FileText } from "lucide-react";
import { listForms } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { FORM_STATUS_LABEL } from "@/lib/labels";
import { NewFormDialog } from "./new-form-dialog";
import { createFormAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FormsPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const db = await dbForRequest();
  const forms = await listForms(db, accountId);

  return (
    <>
      <PageHeader
        title={m["forms.title"]}
        actions={<NewFormDialog action={createFormAction.bind(null, accountId)} />}
      />
      <div className="p-6">
        {forms.length === 0 ? (
          <EmptyState icon={FileText} title={m["forms.empty.title"]} body={m["forms.empty.body"]} />
        ) : (
          <ListPanel as="ul">
            {forms.map((form) => (
              <li key={form.id} className={LIST_ROW}>
                <Link
                  href={`/dashboard/accounts/${accountId}/forms/${form.id}`}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3 transition-colors",
                    // The ladder's raised step, the same one table rows use —
                    // `bg-secondary/60` was a 60% alpha of --surface-3.
                    "hover:bg-[var(--surface-3)]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-card-foreground">
                      {form.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(form.created_at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {form.submissionCount} {m["forms.submissions"].toLowerCase()}
                    </span>
                    <Badge variant={form.status === "published" ? "default" : "secondary"}>
                      {FORM_STATUS_LABEL[form.status] ?? form.status}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ListPanel>
        )}
      </div>
    </>
  );
}
