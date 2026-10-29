import { NextResponse } from "next/server";
import { readGroup, listOpenDocumentRequests, documentRequestTarget } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { requestChannels } from "@/lib/document-requests/deliver";
import type { DocumentRequestsResponse } from "@/lib/document-requests/requests-load";

export const dynamic = "force-dynamic";

/**
 * The Documents card's requests for a household or business (spec 4.2): the group's OPEN requests and
 * the channels the dialog may offer. A group speaks through its call-first member (plan deviation 3),
 * read here on the request client, so a member RLS hides from the caller offers no text or email.
 * Request client for every record read; the ledger client for the consent state only, built after
 * readGroup proved the group is the caller's. Loads and fails on its own (spec 6).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; groupId: string }> }) {
  const { accountId, groupId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const groupId = raw.toLowerCase();
  const db = await dbForRequest();
  try {
    if (!(await readGroup(db, accountId, groupId))) return NextResponse.json({}, { status: 404 });
    // F-118 part 1 (plan Task 6): logged after the proof, before any data leaves. Inside this try: a
    // rejected write is caught below and answered as this route's own 500 (fail closed).
    if (!(await noteOpenedApi(access, accountId, { kind: "group", recordId: groupId }))) return NextResponse.json({}, { status: 404 });
    const now = new Date();
    const [requests, target] = await Promise.all([
      listOpenDocumentRequests(db, accountId, { kind: "group", id: groupId }, now),
      documentRequestTarget(db, accountId, { contact_id: null, client_group_id: groupId }),
    ]);
    const channels = await requestChannels(db, ledgerDb(), accountId, target);
    const body: DocumentRequestsResponse = { now: now.toISOString(), channels, requests };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`document requests read (account ${accountId}, group ${groupId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
