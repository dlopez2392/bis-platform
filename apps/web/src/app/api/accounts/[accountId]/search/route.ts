import { NextResponse } from "next/server";
import { listContacts, searchCalls, searchConversations, sanitizeSearchTerm } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { callerLabel, OUTCOMES } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calls/format";

export const dynamic = "force-dynamic";

export type SearchHit = {
  id: string;
  label: string;
  sublabel: string | null;
  /** Raw ISO, formatted by the CLIENT. Never formatted here: Intl on the
   *  server formats in the SERVER's zone (UTC on Vercel), which renders the
   *  previous day for every Americas timezone after ~6pm local. */
  at: string | null;
  href: string;
};

export type SearchResults = {
  contacts: SearchHit[];
  calls: SearchHit[];
  conversations: SearchHit[];
};

/** Per source, so one noisy source cannot crowd the others out. */
const PER_SOURCE = 5;
/** Below this the palette shows its static half only — a one-character query
 *  matches most of a CRM and costs three round trips to say so. */
const MIN_QUERY = 2;

const EMPTY: SearchResults = { contacts: [], calls: [], conversations: [] };

const UNNAMED = "Unnamed contact";

function joinName(first: string | null, last: string | null): string {
  return [first, last].map((p) => p?.trim() ?? "").filter(Boolean).join(" ");
}

/**
 * The ⌘K palette's live half.
 *
 * A GET ROUTE HANDLER, not a server action, and for a specific reason: Next
 * serializes same-client server actions, so a per-keystroke read written as an
 * action would queue the user's own mutations behind every letter they type.
 * Same call the P4 contact-summary route made.
 *
 * `dbForRequest()` — RLS-scoped — is load-bearing, NOT a style choice. A client
 * session must see exactly its own rows, and `serviceDb()` would hand back
 * every tenant's. Nothing below this line can prove that; only the client-role
 * e2e in palette.spec.ts can.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  const access = await apiAccountAccess(accountId);
  // 404 for both no-access and unknown account — never confirm existence.
  if (!access) return NextResponse.json({}, { status: 404 });

  // The floor is applied to the SANITIZED term, not the raw one, and that
  // distinction is load-bearing twice over.
  //
  // `listContacts` is a LIST function with an optional search — an empty term
  // legitimately means "no filter, return the list", which is what the
  // contacts page depends on. Its two siblings here are SEARCH functions and
  // return [] instead. So a query of "%%" or "()", which sanitizes away to
  // nothing, would have reached listContacts as "no filter" and rendered the
  // account's five most recent contacts as if they had MATCHED — a lie about
  // a search. Gating here keeps listContacts' contract intact for its other
  // callers while never handing it an empty term from this route.
  //
  // It also closes the raw-length hole: "(a)" is three characters and clears
  // a raw floor, but carries one character of actual query.
  const raw = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const q = sanitizeSearchTerm(raw);
  if (q.length < MIN_QUERY) return NextResponse.json(EMPTY);

  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const base = `/dashboard/accounts/${accountId}`;

  // No try/catch: a source that throws must 500 so the palette can show its
  // honest error row. Swallowing it here would render as "no matches", which
  // tells the user their contact does not exist when the read actually failed.
  const [contacts, calls, conversations] = await Promise.all([
    listContacts(db, accountId, { search: q, limit: PER_SOURCE }),
    searchCalls(db, accountId, { search: q, limit: PER_SOURCE }),
    searchConversations(db, accountId, { search: q, limit: PER_SOURCE }),
  ]);

  const body: SearchResults = {
    contacts: (contacts ?? []).slice(0, PER_SOURCE).map((c): SearchHit => ({
      id: c.id,
      label: joinName(c.first_name, c.last_name) || UNNAMED,
      sublabel: c.email ?? c.phone ?? null,
      at: null,
      href: `${base}/contacts/${c.id}`,
    })),
    calls: calls.slice(0, PER_SOURCE).map((c): SearchHit => ({
      id: c.id,
      label: callerLabel(c),
      // The localized label, never the raw `calls.outcome` enum. Unknown
      // values fall back to the raw string instead of throwing and taking the
      // whole search down — same defensive lookup the P4 summary route uses.
      sublabel: (OUTCOMES as Record<string, { label: string }>)[c.outcome]?.label
        ?? String(c.outcome),
      at: c.started_at,
      href: `${base}/calls/${c.id}`,
    })),
    conversations: conversations.slice(0, PER_SOURCE).map((v): SearchHit => ({
      id: v.id,
      label: joinName(v.contactFirstName, v.contactLastName) || UNNAMED,
      sublabel: v.lastMessagePreview,
      // Deliberately null. `sublabel` here is the MATCHED message, but
      // `lastMessageAt` is the thread's NEWEST message — pairing them would
      // caption a line from March with today's date. No date beats a wrong one.
      at: null,
      // The conversations page selects a thread with ?c= — there is no
      // /conversations/<id> route (conversations/page.tsx).
      href: `${base}/conversations?c=${v.id}`,
    })),
  };

  return NextResponse.json(body);
}
