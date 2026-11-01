import { NextResponse } from "next/server";
import { searchContacts, searchCalls, searchConversations, searchTermLength } from "@bis/db";
import { contactSearchPlan, phoneMatches } from "@bis/db/contact-search";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { callerLabel, OUTCOMES, outcomeLabel } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calls/format";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import { holdingLabel } from "@/lib/contacts/holding-label";

export const dynamic = "force-dynamic";

export type SearchHit = {
  id: string;
  label: string;
  /** F-092 final review M-4a: set (only ever `true`) when `label` is this route's stand-in for a contact with no
   *  name ("Unnamed contact"), never the customer's own words, so no client marks a search's letters in it. */
  unnamed?: true;
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

/** F-092: `types` narrows which searches run (Add job and held email want contacts only, and should not pay for
 *  the other two). A comma list kept to the three known names; none left (or no `types`) means all three. */
const SOURCES = ["contacts", "calls", "conversations"] as const;
type Source = (typeof SOURCES)[number];
function sourcesOf(types: string | null): ReadonlySet<Source> {
  const named = (types ?? "").split(",").map((t) => t.trim())
    .filter((t): t is Source => (SOURCES as readonly string[]).includes(t));
  return new Set(named.length > 0 ? named : SOURCES);
}

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

  // The floor is applied to the SANITIZED term's length, not the raw one,
  // and that distinction is load-bearing twice over.
  //
  // A query of "%%" or "()" sanitizes away to nothing. This route once called
  // `listContacts`, a LIST function for which an empty term means "no filter,
  // return the list", and would have rendered the account's five most recent
  // contacts as if they had MATCHED. `searchContacts` answers [] for it now,
  // as its two siblings always did, but the floor still says so here first,
  // without a round trip.
  //
  // It also closes the raw-length hole: "(a)" is three characters and clears
  // a raw floor, but carries one character of actual query.
  //
  // REVIEW CORRECTION: measured with `searchTermLength`, not the escaped
  // term's length — `sanitizeSearchTerm` escapes a lone "_" to "\_" (two
  // characters), which cleared this floor on one real character. The palette
  // (command-palette.tsx) measures the SAME way, off the same raw query, so
  // the two sides still agree on which of them rejected it.
  //
  // F-092: the RAW term goes to all three searches. Each sanitizes for itself
  // (searchCalls, searchConversations, and searchContacts through the contact
  // list's own filter, which also folds accents and reads phone digits off the
  // raw term), so sanitizing here as well only ever did it twice.
  const query = new URL(req.url).searchParams;
  const raw = (query.get("q") ?? "").trim();
  if (searchTermLength(raw) < MIN_QUERY) return NextResponse.json(EMPTY);
  const sources = sourcesOf(query.get("types"));

  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const base = `/dashboard/accounts/${accountId}`;

  // No try/catch: a source that throws must 500 so the palette can show its
  // honest error row. Swallowing it here would render as "no matches", which
  // tells the user their contact does not exist when the read actually failed.
  // A source `types` left out answers [] without being asked.
  const [contacts, calls, conversations, prefs, accountLanguage] = await Promise.all([
    sources.has("contacts") ? searchContacts(db, accountId, { term: raw, limit: PER_SOURCE }) : [],
    sources.has("calls") ? searchCalls(db, accountId, { search: raw, limit: PER_SOURCE }) : [],
    sources.has("conversations") ? searchConversations(db, accountId, { search: raw, limit: PER_SOURCE }) : [],
    // S-10 fix round I7: the call hits' caller and outcome words follow the
    // READER (the dashboard's own resolver). getPersonPrefs never rejects.
    // The account's language matters only to a client reader, and its read
    // is cosmetic: a failure costs the Spanish, never the search.
    // Review fix round, Minor 2: this used to skip the read whenever `calls` wasn't among the
    // requested `types`, which made sense while only the call hits read `locale` — but the
    // conversations hits' holding label (holdingLabel) now reads it too, so a conversations-only
    // request (types=conversations) on a client-role request must still resolve the account's
    // language, not just a calls-including one.
    getPersonPrefs(),
    access.isAgency
      ? Promise.resolve({ language: null as Locale | null })
      : Promise.resolve(db.from("accounts").select("language").eq("id", accountId).maybeSingle())
        .then(({ data, error }) => {
          if (error) console.error(`search ${accountId}: account language read failed, reading English: ${error.message}`);
          return { language: (data as { language?: Locale | null } | null)?.language ?? null };
        }),
  ]);
  // Operators never inherit the account's language (requestLocale's own rule).
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language });
  // F-092: a phone search shows the number it matched, not the email beside it.
  const plan = contactSearchPlan(raw);

  const body: SearchResults = {
    contacts: (contacts ?? []).slice(0, PER_SOURCE).map((c): SearchHit => {
      const name = joinName(c.first_name, c.last_name);
      return {
        id: c.id,
        label: name || UNNAMED,
        ...(name ? {} : { unnamed: true as const }),
        sublabel: phoneMatches(plan, c.phone) ? c.phone : c.email ?? c.phone ?? null,
        at: null,
        href: `${base}/contacts/${c.id}`,
      };
    }),
    calls: calls.slice(0, PER_SOURCE).map((c): SearchHit => ({
      id: c.id,
      label: callerLabel(c, locale),
      // The localized label, never the raw `calls.outcome` enum. Unknown
      // values fall back to the raw string instead of throwing and taking the
      // whole search down — same defensive lookup the P4 summary route uses.
      sublabel: Object.hasOwn(OUTCOMES, c.outcome) ? outcomeLabel(c.outcome, locale) : String(c.outcome),
      at: c.started_at,
      href: `${base}/calls/${c.id}`,
    })),
    conversations: conversations.slice(0, PER_SOURCE).map((v): SearchHit => ({
      id: v.id,
      label: v.holdsSharedNumber ? holdingLabel(v.sharedNumber, locale) : (joinName(v.contactFirstName, v.contactLastName) || UNNAMED),
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
