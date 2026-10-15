import { NextResponse } from "next/server";
import { getContact, listOpenDocumentRequests, documentRequestTarget } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { requestChannels } from "@/lib/document-requests/deliver";
import type { DocumentRequestsResponse } from "@/lib/document-requests/requests-load";

export const dynamic = "force-dynamic";

/**
 * The Documents card's requests (spec 4.2): this contact's OPEN requests, each item answered or not,
 * and the channels the dialog may offer (P6). Request client for every record read (RLS decides); the
 * ledger client for the consent state only, built after getContact proved the contact is the
 * caller's (the contact page's own rule, page.tsx:85-98). Loads and fails on its own (spec 6).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const contactId = raw.toLowerCase();
  const db = await dbForRequest();
  try {
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    const now = new Date();
    const [requests, target] = await Promise.all([
      listOpenDocumentRequests(db, accountId, { kind: "contact", id: contactId }, now),
      documentRequestTarget(db, accountId, { contact_id: contactId, client_group_id: null }),
    ]);
    const channels = await requestChannels(db, ledgerDb(), accountId, target);
    const body: DocumentRequestsResponse = { now: now.toISOString(), channels, requests };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`document requests read (account ${accountId}, contact ${contactId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
