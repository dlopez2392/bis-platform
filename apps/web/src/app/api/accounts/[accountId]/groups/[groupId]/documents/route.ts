import { NextResponse } from "next/server";
import { readGroup, listRecordDocuments, listPeopleNames, listLiveDocumentShares } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import type { DocumentsResponse } from "@/lib/documents/documents-load";
import { documentView, documentsClock, documentsSpace } from "@/lib/documents/document-view";

export const dynamic = "force-dynamic";

/**
 * The Documents card's own read for a group (spec 4.5: it loads and fails on its own). Request
 * client only: 0077's RLS decides (the group's visibility, the Technician fence, Owners only).
 * `today` is the account's own day, for expiry words; each row's `addedOn` its added day in the same
 * zone, for "yesterday"; `now` the server's instant, for purge words.
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
    // F-118 part 1 (plan Task 6): logged after the proof, before any data leaves.
    if (!(await noteOpenedApi(access, accountId, { kind: "group", recordId: groupId }))) return NextResponse.json({}, { status: 404 });
    const [docs, { today, zone }, space, shares] = await Promise.all([
      listRecordDocuments(db, accountId, { kind: "group", id: groupId }), documentsClock(db, accountId), documentsSpace(db, accountId),
      // S-07 3b: each live file's latest share-link expiry, under the same RLS. Decorative (the space line's
      // rule): a failed read omits the "Shared" line, never the card.
      listLiveDocumentShares(db, accountId, { kind: "group", id: groupId }, new Date()).catch((e: unknown) => {
        console.error(`documents read shares (account ${accountId}): ${loggableError(e)}`);
        return {} as Record<string, string>;
      })]);
    const all = [...docs.live, ...docs.trashed];
    const names = await listPeopleNames(db, [...new Set(all.map((d) => d.created_by))]).catch((e: unknown) => {
      console.error(`documents read names (account ${accountId}): ${loggableError(e)}`);
      return {} as Record<string, string>;
    });
    const body: DocumentsResponse = {
      today, now: new Date().toISOString(), record: { kind: "group", id: groupId, groupKind: group.kind },
      live: docs.live.map((d) => documentView(d, access.userId, names, zone, Object.hasOwn(shares, d.id) ? shares[d.id]! : null)),
      trashed: docs.trashed.map((d) => documentView(d, access.userId, names, zone)),
      capped: docs.liveMore || docs.trashedMore,
      space,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`documents read (account ${accountId}, group ${groupId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
