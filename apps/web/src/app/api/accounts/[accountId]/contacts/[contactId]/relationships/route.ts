import { NextResponse } from "next/server";
import { getContact, listContactRelationships } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { toRelationshipView, type RelationshipView } from "@/lib/contacts/relationship-view";

export const dynamic = "force-dynamic";

/**
 * The Relationships card's own read (spec §7: it loads and fails on its own). A person the caller
 * cannot read arrives as `person: null`, with no id (C5): the raw rows carry both contact ids, so
 * they never leave this file; only toRelationshipView's output does.
 */
export type RelationshipsResponse = {
  subject: { firstName: string | null; lastName: string | null };
  views: RelationshipView[];
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId: rawContactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(rawContactId)) return NextResponse.json({}, { status: 404 });
  // PostgREST echoes ids lowercase; toRelationshipView compares them as plain strings.
  const contactId = rawContactId.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    const contact = await getContact(db, accountId, contactId);
    if (!contact) return NextResponse.json({}, { status: 404 });
    const { rows, people } = await listContactRelationships(db, accountId, contactId);
    const views = rows.map((r) => toRelationshipView(r, contactId, people)).filter((v): v is RelationshipView => v !== null);
    const body: RelationshipsResponse = {
      subject: { firstName: (contact.first_name as string | null) ?? null, lastName: (contact.last_name as string | null) ?? null },
      views,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`relationships read (account ${accountId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
