import { NextResponse } from "next/server";
import { getContact, listContactGroups, type ContactGroup } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";
import { isUuid } from "@/lib/assign/action-guards";

export const dynamic = "force-dynamic";

/** The Groups card reads this on its own, so it loads and fails on its own (spec §7; record page v2). */
export type GroupsResponse = { groups: ContactGroup[] };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  // A malformed id is a 404 like any contact the caller cannot see, not a 500 from the uuid cast.
  if (!access || !isUuid(contactId)) return NextResponse.json({}, { status: 404 });
  try {
    // RLS-scoped: the contact read IS the authorisation (the texts route's rule).
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    const body: GroupsResponse = { groups: await listContactGroups(db, accountId, contactId) };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`groups route: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
