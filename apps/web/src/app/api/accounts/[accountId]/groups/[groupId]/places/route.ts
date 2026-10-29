import { NextResponse } from "next/server";
import { readGroup, listGroupPlaces } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { accountToday } from "@/lib/contacts/account-today";
import type { PlacesResponse } from "../../../contacts/[contactId]/places/route";

export const dynamic = "force-dynamic";

function withoutAuthor<R extends { created_by: string | null }>(row: R): Omit<R, "created_by"> {
  const copy: Partial<R> = { ...row };
  delete copy.created_by;
  return copy as Omit<R, "created_by">;
}

/**
 * A group's Properties card read (S-03 part 2, C12): its own places only, on the request client, so
 * 0071's RLS decides (a Technician sees every place of a group one of their customers is in, by design).
 * The group read on the caller's client is the authorisation; a group they cannot see reads nothing.
 * The card's parser (`lib/contacts/places-load.ts`) is the contact route's, so the body is that shape
 * with `group` added and no other groups to rank by.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; groupId: string }> }) {
  const { accountId, groupId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  // PostgREST echoes ids lowercase; the card compares them as plain strings.
  const groupId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    const group = await readGroup(db, accountId, groupId);
    if (!group) return NextResponse.json({}, { status: 404 });
    // F-118 part 1 (plan Task 6): logged after the proof, before any data leaves.
    if (!(await noteOpenedApi(access, accountId, { kind: "group", recordId: groupId }))) return NextResponse.json({}, { status: 404 });
    const [read, today] = await Promise.all([listGroupPlaces(db, accountId, groupId), accountToday(db, accountId)]);
    const body: PlacesResponse = {
      subject: { id: groupId, firstName: null, lastName: null },
      group: { id: group.id, kind: group.kind, name: group.name },
      today,
      groups: [],
      places: read.places.map(withoutAuthor),
      placeCount: read.placeCount,
      equipment: read.equipment.map(withoutAuthor),
      equipmentCount: read.equipmentCount,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`group places read (account ${accountId}, group ${groupId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
