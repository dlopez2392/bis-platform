import { NextResponse } from "next/server";
import { getContact, listContactPlaces, type ContactPlaceGroup, type PlaceRow, type EquipmentRow, type GroupKind } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { noteOpenedApi } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { accountToday } from "@/lib/contacts/account-today";

export const dynamic = "force-dynamic";

/**
 * The Properties card's own read (spec §6: it loads and fails on its own). Read on the request
 * client only, so 0071's RLS alone decides what a Technician sees. `today` is the account's own day
 * (YYYY-MM-DD in its zone): warranty status and the not-after-today rule never use the browser's
 * clock. `created_by` (the author's Clerk subject) is stored for S-03's timeline and never sent.
 */
export type PlacesResponse = {
  subject: { id: string; firstName: string | null; lastName: string | null };
  today: string;
  groups: ContactPlaceGroup[];
  places: Omit<PlaceRow, "created_by">[];
  placeCount: number;
  equipment: Omit<EquipmentRow, "created_by">[];
  equipmentCount: number;
  /** S-03 part 2: present when the record is a group (its own route, `…/groups/[groupId]/places`). */
  group?: { id: string; kind: GroupKind; name: string };
};

function withoutAuthor<R extends { created_by: string | null }>(row: R): Omit<R, "created_by"> {
  const copy: Partial<R> = { ...row };
  delete copy.created_by;
  return copy as Omit<R, "created_by">;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId: rawContactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(rawContactId)) return NextResponse.json({}, { status: 404 });
  // PostgREST echoes ids lowercase; the card compares them as plain strings.
  const contactId = rawContactId.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    // The contact read on the caller's own client is the authorisation: a contact they cannot see
    // (another account's, or under 0068 another person's for a Technician) reads nothing else.
    const contact = await getContact(db, accountId, contactId);
    if (!contact) return NextResponse.json({}, { status: 404 });
    // F-118 part 1 (plan Task 6): logged after the proof, before any data leaves.
    if (!(await noteOpenedApi(access, accountId, { kind: "contact", recordId: contactId }))) return NextResponse.json({}, { status: 404 });
    const [read, today] = await Promise.all([listContactPlaces(db, accountId, contactId), accountToday(db, accountId)]);
    const body: PlacesResponse = {
      subject: {
        id: contactId,
        firstName: (contact.first_name as string | null) ?? null,
        lastName: (contact.last_name as string | null) ?? null,
      },
      today,
      groups: read.groups,
      places: read.places.map(withoutAuthor),
      placeCount: read.placeCount,
      equipment: read.equipment.map(withoutAuthor),
      equipmentCount: read.equipmentCount,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`places read (account ${accountId}, contact ${contactId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
