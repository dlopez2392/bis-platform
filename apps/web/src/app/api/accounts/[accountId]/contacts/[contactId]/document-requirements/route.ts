import { NextResponse } from "next/server";
import { getContact, listDocumentRequirements } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { documentsClock } from "@/lib/documents/document-view";
import type { RequirementsResponse } from "@/lib/documents/requirements-load";

export const dynamic = "force-dynamic";

/**
 * The Documents card's checklist (spec 5.3, 5.4): each required category's state for this customer,
 * on the account's own day. Request client only: getContact proves the contact first (RLS, the
 * Technician fence), and 0081's definer read re-checks both fences itself. Loads and fails on its own
 * (spec 6): the card's files never wait on it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const contactId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: never the service client here
  try {
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    // F-118 part 1 (plan Task 6): logged after the proof, before any data leaves.
    if (!(await noteOpenedApi(access, accountId, { kind: "contact", recordId: contactId }))) return NextResponse.json({}, { status: 404 });
    const { today } = await documentsClock(db, accountId);
    const body: RequirementsResponse = { items: await listDocumentRequirements(db, accountId, contactId, today) };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`document requirements read (account ${accountId}, contact ${contactId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
