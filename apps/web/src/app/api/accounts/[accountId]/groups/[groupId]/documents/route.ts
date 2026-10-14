import { NextResponse } from "next/server";
import { readGroup, listRecordDocuments, listPeopleNames } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { accountToday } from "@/lib/contacts/account-today";
import type { DocumentsResponse } from "@/lib/documents/documents-load";
import { documentView } from "@/lib/documents/document-view";

export const dynamic = "force-dynamic";

/**
 * The Documents card's own read for a group (spec 4.5: it loads and fails on its own). Request
 * client only: 0077's RLS decides (the group's visibility, the Technician fence, Owners only).
 * `today` is the account's own day, for expiry words; `now` the server's instant, for purge words.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; groupId: string }> }) {
  const { accountId, groupId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const groupId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    const group = await readGroup(db, accountId, groupId);
    if (!group) return NextResponse.json({}, { status: 404 });
    const [docs, today] = await Promise.all([listRecordDocuments(db, accountId, { kind: "group", id: groupId }), accountToday(db, accountId)]);
    const all = [...docs.live, ...docs.trashed];
    const names = await listPeopleNames(db, [...new Set(all.map((d) => d.created_by))]).catch((e: unknown) => {
      console.error(`documents read names (account ${accountId}): ${loggableError(e)}`);
      return {} as Record<string, string>;
    });
    const body: DocumentsResponse = {
      today, now: new Date().toISOString(), record: { kind: "group", id: groupId, groupKind: group.kind },
      live: docs.live.map((d) => documentView(d, access.userId, names)),
      trashed: docs.trashed.map((d) => documentView(d, access.userId, names)),
      capped: docs.liveMore || docs.trashedMore,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`documents read (account ${accountId}, group ${groupId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
