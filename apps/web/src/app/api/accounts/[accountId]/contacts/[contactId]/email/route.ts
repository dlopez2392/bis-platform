import { NextResponse } from "next/server";
import { getContact } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { loggableError } from "@/lib/loggable-error";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { readEmailView, type EmailView } from "@/lib/consent/email-view";

export const dynamic = "force-dynamic";

/** The drawer's Email row reads this on its own (spec §6: the Messages block's own loading and error). */
export type EmailResponse = { view: EmailView; zone: string };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  // RLS-scoped, and the contact read on it is the authorisation: a contact
  // the caller cannot see (another account's, or under 0068 another person's
  // for a Technician) is a 404 that reads nothing else.
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });
  // F-085 (spec §7.3): consent is keyed by ADDRESS and a STOP can be tied to
  // no contact, so the ledger is read through the ledger client — only now,
  // for this proven contact's own address. Inside the try: a missing service
  // key is the row's error line like any other unreadable ledger.
  try {
    const ledger = ledgerDb();
    const [view, account] = await Promise.all([
      readEmailView(ledger, accountId, contact),
      db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
    ]);
    if (account.error) console.error(`email read: account ${accountId} timezone unreadable: ${loggableError(account.error)}`);
    const zone = await renderZone(account.error ? undefined : (account.data as { timezone: string } | null)?.timezone);
    return NextResponse.json({ view, zone: zone.zone } satisfies EmailResponse);
  } catch (e) {
    // Fails closed: an unreadable ledger is the row's error line, never a guessed "Allowed".
    console.error(`email read: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return NextResponse.json({ error: "unreadable" }, { status: 500 });
  }
}
