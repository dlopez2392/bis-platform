import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getForm, listSubmissions, listCustomFields } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { FormEditor } from "./form-editor";
import { EmbedSnippet } from "./embed-snippet";
import { SubmissionsTable } from "./submissions-table";
import { saveFormAction } from "../actions";
import { dbForRequest } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function FormEditorPage({
  params,
}: { params: Promise<{ accountId: string; formId: string }> }) {
  const { accountId, formId } = await params;
  const db = await dbForRequest();
  const form = await getForm(db, accountId, formId);
  if (!form) notFound();

  const [submissions, customFields, h] = await Promise.all([
    listSubmissions(db, accountId, formId),
    listCustomFields(db, accountId, "contact"),
    headers(),
  ]);

  // Read from the request rather than an env var: the snippet has to point at
  // whatever host the operator is actually on, which differs between localhost,
  // a preview deploy and production.
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageHeader title={form.name} />
      <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <FormEditor
            form={form}
            customFields={customFields}
            action={saveFormAction.bind(null, accountId)}
          />
          <SubmissionsTable
            accountId={accountId}
            submissions={submissions}
          />
        </div>
        <EmbedSnippet
          origin={origin}
          publicId={form.public_id}
          locale={form.locale_default}
          published={form.status === "published"}
        />
      </div>
    </>
  );
}
