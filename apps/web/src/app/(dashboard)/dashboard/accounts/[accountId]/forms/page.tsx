import Link from "next/link";
import { FileText } from "lucide-react";
import { serviceDb, listForms } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { m } from "@/lib/messages";
import { FORM_STATUS_LABEL } from "@/lib/labels";
import { NewFormDialog } from "./new-form-dialog";
import { createFormAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FormsPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const forms = await listForms(serviceDb(), accountId);

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
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {forms.map((form) => (
              <li key={form.id}>
                <Link
                  href={`/dashboard/accounts/${accountId}/forms/${form.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary/60"
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
          </ul>
        )}
      </div>
    </>
  );
}
