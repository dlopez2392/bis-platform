import { NextResponse } from "next/server";
import {
  getContact, listContactTags, listNotes, listContactSubmissions,
  listContactMessages, listContactOpportunities, listContactCalls,
} from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";
import type { OptOutZone } from "@/lib/contacts/marketing-optout";
import { OUTCOMES } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calls/format";

export const dynamic = "force-dynamic";

export type ContactSummary = {
  tags: { id: string; name: string }[];
  recent: {
    kind: "call" | "note" | "submission" | "message" | "opportunity";
    label: string;
    at: string;
  }[];
  /** `contacts.marketing_email_opted_out_at` (0049), for the drawer's "No
   *  marketing emails" switch. Read here rather than off the list row because
   *  a deep link to a contact on another page has only a stub row. */
  marketing_email_opted_out_at: string | null;
  /** The account's zone, resolved by `renderZone` like every other date
   *  screen — the drawer prints the opt-out's "Off since" date in it, and
   *  names the zone on that line when it was `guessed` (#123 m3). */
  zone: OptOutZone;
};

const RECENT_LIMIT = 5;

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

  const [tags, notes, submissions, messages, opportunities, calls, account] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactSubmissions(db, accountId, contactId),
    listContactMessages(db, accountId, contactId),
    listContactOpportunities(db, accountId, contactId),
    listContactCalls(db, accountId, contactId, RECENT_LIMIT),
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
  ]);
  // Not a throw on a failed read, the checklist page's reasoning: the zone is
  // for one date line, and 500ing the whole drawer over it is the worse
  // failure. `undefined` makes `renderZone` fall back (agency zone, else UTC).
  if (account.error) {
    console.error(`contact summary: account ${accountId} timezone read failed: ${account.error.message}`);
  }
  const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);

  type Item = ContactSummary["recent"][number];
  const items: Item[] = [
    ...calls.map((c): Item => ({
      kind: "call",
      // The localized label ("Booked"/"Abandoned"/…), not the raw
      // lowercase `calls.outcome` enum — same map the Calls list/detail
      // pages render from (calls/format.ts). `listContactCalls` types
      // `outcome` as plain `string` (not `CallOutcome`), so the lookup is
      // cast rather than indexed directly — which also means an unknown
      // value falls back to the raw string instead of throwing and taking
      // the whole summary route down with it.
      label: m["drawer.recent.call"].replace(
        "{outcome}",
        (OUTCOMES as Record<string, { label: string }>)[c.outcome]?.label ?? String(c.outcome),
      ),
      at: c.started_at,
    })),
    ...notes.map((n): Item => ({
      kind: "note", label: m["drawer.recent.note"], at: n.created_at,
    })),
    ...submissions.map((s: { created_at: string }): Item => ({
      kind: "submission", label: m["drawer.recent.submission"], at: s.created_at,
    })),
    ...messages.map((x: { created_at: string }): Item => ({
      kind: "message", label: m["drawer.recent.message"], at: x.created_at,
    })),
    ...opportunities.map((o): Item => ({
      kind: "opportunity",
      label: m["drawer.recent.opportunity"]
        .replace("{name}", o.name)
        .replace("{value}", formatCurrency(Number(o.monetary_value))),
      at: o.created_at,
    })),
  ];
  // Epoch-ms sort — sources return mixed lexical ISO forms (+00:00 vs .000Z)
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const body: ContactSummary = {
    tags,
    recent: items.slice(0, RECENT_LIMIT),
    marketing_email_opted_out_at: contact.marketing_email_opted_out_at ?? null,
    zone: { zone: zone.zone, guessed: zone.guessed, label: zone.label },
  };
  return NextResponse.json(body);
}
