import { NextResponse } from "next/server";
import {
  getContact, listContactTags, listNotes, listContactSubmissions,
  listContactMessages, listContactOpportunities, listContactCalls,
} from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export type ContactSummary = {
  tags: { id: string; name: string }[];
  recent: {
    kind: "call" | "note" | "submission" | "message" | "opportunity";
    label: string;
    at: string;
  }[];
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

  const [tags, notes, submissions, messages, opportunities, calls] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactSubmissions(db, accountId, contactId),
    listContactMessages(db, accountId, contactId),
    listContactOpportunities(db, accountId, contactId),
    listContactCalls(db, accountId, contactId, RECENT_LIMIT),
  ]);

  type Item = ContactSummary["recent"][number];
  const items: Item[] = [
    ...calls.map((c): Item => ({
      kind: "call",
      label: m["drawer.recent.call"].replace("{outcome}", String(c.outcome)),
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

  const body: ContactSummary = { tags, recent: items.slice(0, RECENT_LIMIT) };
  return NextResponse.json(body);
}
