import { listTags } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./import-wizard";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * Both audiences, exactly like the contacts list this hangs off — a client
 * imports their own contacts. `requireAccountAccess` is the same guard the
 * sibling actions use; the wizard's own writes are re-checked in the action,
 * so this call gates the SCREEN, not the data.
 *
 * The account's existing tag names are read HERE and handed down: the wizard
 * has to tell the operator how many tags a file would CREATE, and that is only
 * answerable against real tags. Guessing it in the browser would be a number
 * we made up.
 */
export default async function ImportContactsPage(
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  await requireAccountAccess(accountId);
  const tags = await listTags(await dbForRequest(), accountId);

  return (
    <>
      <PageHeader title={m["contacts.import.title"]} />
      <div className="mx-auto max-w-2xl">
        <ImportWizard accountId={accountId} existingTags={tags.map((t) => t.name)} />
      </div>
    </>
  );
}
