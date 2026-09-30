import { NextResponse } from "next/server";
import { getContact } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { loggableError } from "@/lib/loggable-error";
import { readTextsView, type TextsView } from "@/lib/consent/texts-view";

export const dynamic = "force-dynamic";

/** The drawer's Texts row reads this on its own (spec §6: the Messages block's own loading and error),
 *  with the stored phone the Check number pick is judged against (review I3: the number the operator SAW). */
export type TextsResponse = { view: TextsView; zone: string; phone: string | null };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });
  try {
    const [view, account] = await Promise.all([
      readTextsView(db, accountId, contact),
      db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
    ]);
    if (account.error) {
      // Not fatal to the Texts row: renderZone's own fallback (undefined →
      // guessed) still gives a date, just not necessarily this account's.
      console.error(`texts read: account ${accountId} timezone unreadable: ${loggableError(account.error)}`);
    }
    const zone = await renderZone(account.error ? undefined : (account.data as { timezone: string } | null)?.timezone);
    return NextResponse.json({ view, zone: zone.zone, phone: contact.phone ?? null } satisfies TextsResponse);
  } catch (e) {
    // Fails closed: an unreadable ledger is the row's error line, never a guessed "Allowed".
    console.error(`texts read: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return NextResponse.json({ error: "unreadable" }, { status: 500 });
  }
}
