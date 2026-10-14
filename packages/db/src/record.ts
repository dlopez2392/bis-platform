import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countContactBookingsMade, countBookingsMadeFor, listContactUpcomingBookings, listContactBookings,
  type UpcomingBooking, type ContactBookingRow,
} from "./booking";
import { listContactCalls, type ContactCallRow } from "./voice";
import { listNotes, listContactTasks } from "./activities";
import { listContactOpportunities } from "./opportunities";
import { listContactSubmissions } from "./forms";
import { listContactMessages } from "./messaging";
import { countGroupMembers, GROUP_ACTIVITY_CAP, type GroupPerson } from "./client-groups";
import { forContacts, instantKey, TIMELINE_PAGE_SIZE, type TimelineCursor } from "./timeline-cursor";
import type { AuthorKind } from "./provenance";
import { listDocumentTimeline, type TimelineDocument } from "./documents";

export type { TimelineCursor } from "./timeline-cursor";
export type { ContactBookingRow } from "./booking";
export type { ContactCallRow } from "./voice";
export type { ContactMessageRow } from "./messaging";
export { TIMELINE_PAGE_SIZE } from "./timeline-cursor";

/**
 * The contact record page's checked facts and "Next up" (S-03 part 1, 1a; spec §7). Bounded reads
 * only: exact head counts, one-row reads, open deals up to the cap and Next up up to its limit;
 * never an unbounded list. Every read runs on the caller's client, so RLS (0068's Technician
 * fences included) decides what is counted; there is no role branch here. A count the server did
 * not return is a failed read, never a zero: postgrest-js turns a HEAD request's empty 404 into
 * `{ error: null, count: null }` (status 204), so `count ?? 0` would report a failure as "none".
 */
export type Fact<T> = { ok: true; value: T } | { ok: false };
export type LastTalkedChannel = "text" | "email" | "call";
export type LastTalked = { at: string; channel: LastTalkedChannel };
export type OpenDeals = { count: number; amount: number | null };
export type ContactFacts = { bookingsMade: Fact<number>; lastTalked: Fact<LastTalked | null>; openDeals: Fact<OpenDeals> };
/** "people" is the group page's member count (S-03 part 2b, plan deviation 9). */
export type FactName = "bookings" | "talked" | "deals" | "people";
/** Past this many open deals the summary leaves the amount out rather than understate it. */
export const OPEN_DEALS_SUM_CAP = 100;

async function settle<T>(name: FactName, read: () => Promise<T>, onError?: (name: FactName, e: unknown) => void): Promise<Fact<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (e) {
    onError?.(name, e);
    return { ok: false };
  }
}

/** The newest email or text with this customer that did not fail. `form` and `voice` rows are the
 *  inbox's copies of a submission, a booking change or a call (spec C4); they are not talking. */
async function newestConversationMessage(db: SupabaseClient, accountId: string, contactId: string): Promise<LastTalked | null> {
  const { data: convo, error } = await db.from("conversations").select("id")
    .eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`newestConversationMessage failed: ${error.message}`);
  if (!convo) return null;
  const { data, error: mErr } = await db.from("messages").select("channel, created_at")
    .eq("account_id", accountId).eq("conversation_id", (convo as { id: string }).id)
    .in("channel", ["email", "sms"]).not("status", "in", "(failed,bounced)")
    .order("created_at", { ascending: false }).limit(1);
  if (mErr) throw new Error(`newestConversationMessage failed: ${mErr.message}`);
  const row = ((data ?? []) as { channel: "email" | "sms"; created_at: string }[])[0];
  return row ? { at: row.created_at, channel: row.channel === "sms" ? "text" : "email" } : null;
}

async function lastTalked(db: SupabaseClient, accountId: string, contactId: string): Promise<LastTalked | null> {
  const [message, calls] = await Promise.all([
    newestConversationMessage(db, accountId, contactId),
    listContactCalls(db, accountId, contactId, 1, { excludeSpam: true }),
  ]);
  const call: LastTalked | null = calls[0] ? { at: calls[0].started_at, channel: "call" } : null;
  if (!message) return call;
  if (!call) return message;
  return Date.parse(call.at) > Date.parse(message.at) ? call : message;
}

async function openDeals(db: SupabaseClient, accountId: string, contactId: string, cap: number): Promise<OpenDeals> {
  const { data, count, error } = await db.from("opportunities").select("monetary_value", { count: "exact" })
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "open")
    .order("id", { ascending: true }).limit(cap);
  if (error) throw new Error(`openDeals failed: ${error.message}`);
  // Fail closed: without the exact count, the rows (at most `cap`) could understate it.
  if (count === null) throw new Error("openDeals failed: no exact count returned");
  const rows = (data ?? []) as { monetary_value: number | string }[];
  if (count > rows.length) return { count, amount: null };
  // monetary_value is numeric(12,2): summing whole cents keeps 0.10 + 0.20 at 0.3.
  const cents = rows.reduce((sum, r) => sum + Math.round(Number(r.monetary_value) * 100), 0);
  return { count, amount: cents / 100 };
}

/** Never throws: a failed read is that fact's `{ ok: false }`, named to `onError` for the log. */
export async function contactFacts(
  db: SupabaseClient, accountId: string, contactId: string,
  opts: { onError?: (name: FactName, e: unknown) => void; openDealsCap?: number } = {},
): Promise<ContactFacts> {
  const cap = opts.openDealsCap ?? OPEN_DEALS_SUM_CAP;
  const [bookingsMade, talked, deals] = await Promise.all([
    settle("bookings", () => countContactBookingsMade(db, accountId, contactId), opts.onError),
    settle("talked", () => lastTalked(db, accountId, contactId), opts.onError),
    settle("deals", () => openDeals(db, accountId, contactId, cap), opts.onError),
  ]);
  return { bookingsMade, lastTalked: talked, openDeals: deals };
}

/** "Last talked … with Ana (text)" (S-03 part 2b, C9): across a household, who is the useful fact. */
export type GroupLastTalked = LastTalked & { contactId: string };
export type GroupFacts = { bookingsMade: Fact<number>; lastTalked: Fact<GroupLastTalked | null> };

/** The newest email or text that did not fail, across every conversation of the set (C4's filters,
 *  `newestConversationMessage`'s), with the member whose conversation carried it. */
async function newestSetMessage(db: SupabaseClient, accountId: string, contactIds: readonly string[]): Promise<GroupLastTalked | null> {
  const { data: convos, error } = await forContacts(
    db.from("conversations").select("id, contact_id").eq("account_id", accountId), "contact_id", contactIds);
  if (error) throw new Error(`newestSetMessage failed: ${error.message}`);
  const list = (convos ?? []) as { id: string; contact_id: string }[];
  if (list.length === 0) return null;
  const owner = new Map(list.map((c) => [c.id, c.contact_id]));
  const { data, error: mErr } = await db.from("messages").select("conversation_id, channel, created_at")
    .eq("account_id", accountId).in("conversation_id", list.map((c) => c.id))
    .in("channel", ["email", "sms"]).not("status", "in", "(failed,bounced)")
    .order("created_at", { ascending: false }).limit(1);
  if (mErr) throw new Error(`newestSetMessage failed: ${mErr.message}`);
  const row = ((data ?? []) as { conversation_id: string; channel: "email" | "sms"; created_at: string }[])[0];
  const contactId = row ? owner.get(row.conversation_id) : undefined;
  return row && contactId ? { at: row.created_at, channel: row.channel === "sms" ? "text" : "email", contactId } : null;
}

async function setLastTalked(db: SupabaseClient, accountId: string, contactIds: readonly string[]): Promise<GroupLastTalked | null> {
  const [message, calls] = await Promise.all([
    newestSetMessage(db, accountId, contactIds),
    listContactCalls(db, accountId, contactIds, 1, { excludeSpam: true }),
  ]);
  const call: GroupLastTalked | null = calls[0] ? { at: calls[0].started_at, channel: "call", contactId: calls[0].contact_id } : null;
  if (!message) return call;
  if (!call) return message;
  return Date.parse(call.at) > Date.parse(message.at) ? call : message;
}

/**
 * The group page's checked facts across its activity set (S-03 part 2b, spec §8.6, C8, C9). Never
 * throws: a failed read is that fact's `{ ok: false }`, named to `onError`. An empty set reads
 * nothing (PostgREST's `in.()` is not a query anyone means).
 */
export async function groupFacts(
  db: SupabaseClient, accountId: string, contactIds: readonly string[],
  opts: { onError?: (name: FactName, e: unknown) => void } = {},
): Promise<GroupFacts> {
  if (contactIds.length === 0) return { bookingsMade: { ok: true, value: 0 }, lastTalked: { ok: true, value: null } };
  const [bookingsMade, lastTalked] = await Promise.all([
    settle("bookings", () => countBookingsMadeFor(db, accountId, contactIds), opts.onError),
    settle("talked", () => setLastTalked(db, accountId, contactIds), opts.onError),
  ]);
  return { bookingsMade, lastTalked };
}

export type NextUpTask = { id: string; title: string; due_at: string };
export type ContactNextUp = { bookings: UpcomingBooking[]; datedTasks: NextUpTask[]; undatedCount: number };

/**
 * "Next up" (spec §9.3, C9): bookings still ahead, open To-dos WITH a due date (overdue ones sort
 * first because they are earliest), and a head count of open To-dos with none. An undated To-do has
 * no "next" to sort by, so it is counted, never listed. THROWS on a read error.
 */
export async function contactNextUp(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string, limit = 3,
): Promise<ContactNextUp> {
  const [bookings, dated, undated] = await Promise.all([
    listContactUpcomingBookings(db, accountId, contactId, nowIso, limit),
    db.from("tasks").select("id, title, due_at")
      .eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).not("due_at", "is", null)
      .order("due_at", { ascending: true }).order("id", { ascending: true }).limit(limit),
    db.from("tasks").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).is("due_at", null),
  ]);
  if (dated.error) throw new Error(`contactNextUp To-dos failed: ${dated.error.message}`);
  if (undated.error) throw new Error(`contactNextUp undated count failed: ${undated.error.message}`);
  if (undated.count === null) throw new Error("contactNextUp undated count failed: no count returned");
  return { bookings, datedTasks: (dated.data ?? []) as NextUpTask[], undatedCount: undated.count };
}

export type GroupNextUp = { bookings: UpcomingBooking[]; datedTasks: (NextUpTask & { contact_id: string })[]; undatedCount: number };

/**
 * The group page's Next up (S-03 part 2b, C9): `contactNextUp`'s three reads across the set, each row
 * carrying its member so the card can say whose it is. An empty set reads nothing. THROWS on a read
 * error or a count-less undated count (#245).
 */
export async function groupNextUp(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], nowIso: string, limit = 3,
): Promise<GroupNextUp> {
  if (contactIds.length === 0) return { bookings: [], datedTasks: [], undatedCount: 0 };
  const [bookings, dated, undated] = await Promise.all([
    listContactUpcomingBookings(db, accountId, contactIds, nowIso, limit),
    forContacts(db.from("tasks").select("id, contact_id, title, due_at").eq("account_id", accountId), "contact_id", contactIds)
      .is("completed_at", null).not("due_at", "is", null)
      .order("due_at", { ascending: true }).order("id", { ascending: true }).limit(limit),
    forContacts(db.from("tasks").select("id", { count: "exact", head: true }).eq("account_id", accountId), "contact_id", contactIds)
      .is("completed_at", null).is("due_at", null),
  ]);
  if (dated.error) throw new Error(`groupNextUp To-dos failed: ${dated.error.message}`);
  if (undated.error) throw new Error(`groupNextUp undated count failed: ${undated.error.message}`);
  if (undated.count === null) throw new Error("groupNextUp undated count failed: no count returned");
  return { bookings, datedTasks: (dated.data ?? []) as GroupNextUp["datedTasks"], undatedCount: undated.count };
}

/** How many visible memberships the activity ranking reads, newest-joined first (spec §6, C5). */
export const GROUP_ACTIVITY_SCAN = 500;
/** `more`: the scan held more visible members than `cap`, so the cap line can still be said when the
 *  exact count failed (review of Task 16). */
/** S-09 §9: each member's own language rides along (0076), for the group timeline's per-row rule. */
export type GroupActivity = { people: (GroupPerson & { language: "en" | "es" | null })[]; total: Fact<number>; more: boolean };

/**
 * C5's set: the call-first member (when visible), then by the customer's one conversation's
 * last_message_at desc nulls last, then the membership's created_at desc, then contact_id desc; cut at
 * `cap`. PostgREST cannot order a parent by a to-many embed (groups spec ruling 13.1), so the sort is
 * here, over at most GROUP_ACTIVITY_SCAN memberships, read call-first FIRST so the call-first member is
 * inside the scan however early they joined. `total` is the exact visible count, its own read (plan
 * deviation 9): a failure costs the people fact (named to `onError` as "people"), never the page.
 * `opts.scan` exists so a test can show the call-first order with a handful of rows. THROWS on the scan.
 */
export async function groupActivityMembers(
  db: SupabaseClient, accountId: string, groupId: string, cap = GROUP_ACTIVITY_CAP,
  opts: { onError?: (name: FactName, e: unknown) => void; scan?: number } = {},
): Promise<GroupActivity> {
  type Row = { contact_id: string; is_primary_contact: boolean; created_at: string;
    contacts: { first_name: string | null; last_name: string | null; language: "en" | "es" | null;
      conversations: { last_message_at: string | null }[] | null } | null };
  const [scan, total] = await Promise.all([
    db.from("client_group_members")
      .select("contact_id, is_primary_contact, created_at, contacts(first_name, last_name, language, conversations(last_message_at))")
      .eq("account_id", accountId).eq("client_group_id", groupId)
      .order("is_primary_contact", { ascending: false })
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(opts.scan ?? GROUP_ACTIVITY_SCAN),
    settle("people", () => countGroupMembers(db, accountId, groupId), opts.onError),
  ]);
  if (scan.error) throw new Error(`groupActivityMembers failed: ${scan.error.message}`);
  const rows = ((scan.data ?? []) as unknown as Row[]).filter((r) => r.contacts !== null);
  // instantKey (timeline-cursor.ts) sorts to the microsecond whatever offset PostgREST wrote.
  const lastAt = (r: Row) => {
    const v = r.contacts!.conversations?.[0]?.last_message_at ?? null;
    return v === null ? null : instantKey(v);
  };
  const desc = (x: string, y: string) => (x === y ? 0 : x < y ? 1 : -1);
  rows.sort((a, b) => {
    const la = lastAt(a), lb = lastAt(b);
    return Number(b.is_primary_contact) - Number(a.is_primary_contact)
      || (la === lb ? 0 : la === null ? 1 : lb === null ? -1 : desc(la, lb))
      || desc(instantKey(a.created_at), instantKey(b.created_at))
      || desc(a.contact_id, b.contact_id);
  });
  return {
    people: rows.slice(0, cap).map((r) => ({
      contactId: r.contact_id, firstName: r.contacts!.first_name, lastName: r.contacts!.last_name,
      language: r.contacts!.language ?? null,
    })),
    total,
    more: rows.length > cap,
  };
}

export type TimelineSource = "notes" | "todos" | "deals" | "forms" | "messages" | "bookings" | "calls" | "documents";
export const TIMELINE_SOURCES: readonly TimelineSource[] = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls", "documents"];

export type TimelineNote = { id: string; body: string; author_id: string | null; created_at: string };
export type TimelineTask = {
  id: string; title: string; due_at: string | null; completed_at: string | null; created_at: string;
  consent_event_id: string | null; call_id: string | null; assigned_to: string | null; created_by: string | null;
};
export type TimelineDeal = {
  id: string; name: string; status: string; monetary_value: number | string; created_at: string; created_by: string | null;
};
export type TimelineSubmission = {
  id: string; created_at: string; formName: string;
  answers: { key: string; label: string; value: string }[]; author_kind: "customer" | "ai";
};
export type TimelineMessage = {
  id: string; channel: "email" | "sms"; direction: "inbound" | "outbound"; status: string;
  subject: string | null; body: string; error: string | null; created_at: string;
  /** NOT NULL since 0074 (the migration backfilled every row the build before 1b had written, then
   *  closed the column). */
  author_kind: AuthorKind; author_id: string | null;
};
/** Every variant names its member (`contactId`, S-03 part 2b): the group page's merged timeline says
 *  whose row it is. On the contact page it is always that page's contact. */
export type TimelineEntry =
  | { kind: "note"; id: string; at: string; contactId: string; note: TimelineNote }
  | { kind: "task"; id: string; at: string; contactId: string; task: TimelineTask }
  | { kind: "deal"; id: string; at: string; contactId: string; deal: TimelineDeal }
  | { kind: "submission"; id: string; at: string; contactId: string; submission: TimelineSubmission }
  | { kind: "message"; id: string; at: string; contactId: string; message: TimelineMessage }
  | { kind: "booking"; id: string; at: string; contactId: string; booking: ContactBookingRow }
  | { kind: "call"; id: string; at: string; contactId: string; call: ContactCallRow }
  /** S-07 (plan deviation 3): one row per listed document, read from `documents` so RLS decides. A group's own file has contactId "". */
  | { kind: "document"; id: string; at: string; contactId: string; document: TimelineDocument };
export type TimelinePage = { items: TimelineEntry[]; older: TimelineCursor | null; failed: TimelineSource[] };

/** (at desc, id desc). `at` to the microsecond (instantKey); ids as Postgres orders uuids (bytewise,
 *  which is the lowercase hex string's order). */
export function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number {
  const ka = instantKey(a.at);
  const kb = instantKey(b.at);
  if (ka !== kb) return ka < kb ? 1 : -1;
  const ia = a.id.toLowerCase();
  const ib = b.id.toLowerCase();
  return ia === ib ? 0 : ia < ib ? 1 : -1;
}

/**
 * The record page's timeline (S-03 part 1, 1b; spec §6, §7, C3), for one person or (2b, C6) a
 * household's set, each entry naming its member. Eight sources (S-07 added documents; a group page
 * passes `opts.groupId` so the group's OWN files are read too), each read on the
 * caller's client (RLS, 0068's Technician fences included, decides what is visible), merged into ONE
 * page ordered (at desc, id desc) with the contact list's cursor. Each source reads `limit + 1` rows
 * past the cursor, so the merge of the SUCCESSFUL sources' rows can tell whether more exist: `older`
 * is that next cursor exactly when the merge holds more than `limit` rows, `null` otherwise — a
 * source that fails neither sets nor clears it. A failed source contributes zero rows to the merge
 * (named in `failed`, and to `onError` for the log, never thrown): its own rows past this page stay
 * unknown, neither promised as `older` nor denied.
 */
export async function listTimelinePage(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], before?: TimelineCursor,
  opts: { limit?: number; onError?: (source: TimelineSource, e: unknown) => void; groupId?: string } = {},
): Promise<TimelinePage> {
  // A set with no one in it (a group none of whose members this reader can see) has nothing to
  // read: PostgREST's `in.()` is not a query anyone means, and forContacts refuses it.
  if (contactIds.length === 0) return { items: [], older: null, failed: [] };
  const limit = opts.limit ?? TIMELINE_PAGE_SIZE;
  const page = { before, limit: limit + 1 };
  // One person keeps the `.eq` path the contact page has always read; a set is `.in`.
  const who: string | readonly string[] = contactIds.length === 1 ? contactIds[0]! : contactIds;
  const settle = async (source: TimelineSource, read: () => Promise<TimelineEntry[]>) => {
    try {
      return { source, entries: await read() };
    } catch (e) {
      opts.onError?.(source, e);
      return { source, entries: null };
    }
  };
  const results = await Promise.all([
    settle("notes", async () => (((await listNotes(db, accountId, who, page)) ?? []) as (TimelineNote & { contact_id: string })[])
      .map((note): TimelineEntry => ({ kind: "note", id: note.id, at: note.created_at, contactId: note.contact_id, note }))),
    settle("todos", async () => (await listContactTasks(db, accountId, who, page))
      .map((t): TimelineEntry => ({ kind: "task", id: t.id, at: t.created_at, contactId: t.contact_id, task: { ...t, created_by: t.created_by ?? null } }))),
    settle("deals", async () => (((await listContactOpportunities(db, accountId, who, page)) ?? []) as (TimelineDeal & { contact_id: string })[])
      .map((deal): TimelineEntry => ({ kind: "deal", id: deal.id, at: deal.created_at, contactId: deal.contact_id, deal }))),
    // contact_id is nullable on SubmissionRow, but this read filters on it, so every row carries it.
    settle("forms", async () => (await listContactSubmissions(db, accountId, who, page))
      .map((s): TimelineEntry => ({ kind: "submission", id: s.id, at: s.created_at, contactId: s.contact_id ?? "", submission: {
        // Review note: `?? "customer"` is unreachable AT THIS CALL SITE — `page` above is always a
        // real object, so listContactSubmissions always selects author_kind here, and the column has
        // been NOT NULL DEFAULT 'customer' since 0073. Kept rather than removed: the field's type
        // (SubmissionRow's `author_kind?`) is still genuinely optional for forms.ts's OTHER caller
        // (the record-summary route, which never passes a page and never selects the column), and
        // dropping the default would need an unsafe cast here to satisfy that shared type, not a real
        // simplification.
        id: s.id, created_at: s.created_at, formName: s.formName, answers: s.answers, author_kind: s.author_kind ?? "customer",
      } }))),
    // Page mode tags every message with its own conversation's contact_id (listContactMessages).
    settle("messages", async () => (await listContactMessages(db, accountId, who, { ...page, channels: ["email", "sms"] }))
      .map((m): TimelineEntry => ({ kind: "message", id: m.id, at: m.created_at, contactId: m.contact_id ?? "", message: m as TimelineMessage }))),
    settle("bookings", async () => (await listContactBookings(db, accountId, who, page))
      .map((booking): TimelineEntry => ({ kind: "booking", id: booking.id, at: booking.created_at, contactId: booking.contact_id, booking }))),
    settle("calls", async () => (await listContactCalls(db, accountId, who, page.limit, { before }))
      .map((call): TimelineEntry => ({ kind: "call", id: call.id, at: call.started_at, contactId: call.contact_id, call }))),
    settle("documents", async () => (await listDocumentTimeline(db, accountId, who, opts.groupId ?? null, page))
      .map((d): TimelineEntry => ({ kind: "document", id: d.id, at: d.created_at, contactId: d.contact_id ?? "", document: d }))),
  ]);
  const failed = results.flatMap((r) => (r.entries === null ? [r.source] : []));
  const merged = results.flatMap((r) => r.entries ?? []).sort(compareTimelineEntries);
  const items = merged.slice(0, limit);
  const last = items.at(-1);
  return { items, older: merged.length > limit && last ? { v: last.at, id: last.id } : null, failed };
}

/** The contact page's timeline (S-03 1b): `listTimelinePage` for one person, on the `.eq` path. */
export async function listContactTimelinePage(
  db: SupabaseClient, accountId: string, contactId: string, before?: TimelineCursor,
  opts: { limit?: number; onError?: (source: TimelineSource, e: unknown) => void } = {},
): Promise<TimelinePage> {
  return listTimelinePage(db, accountId, [contactId], before, opts);
}

/**
 * Display names for person marks (spec §6, Names): `name ?? email` (the picker's rule), for the
 * distinct Clerk ids asked, on the caller's client, so RLS decides who may be named (users_member_read
 * and users_agency_read, 0066). An id with no readable row is absent; the caller reads it as
 * "Someone on the team". No service-role read names anyone. THROWS on a read error.
 */
export async function listPeopleNames(db: SupabaseClient, clerkUserIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(clerkUserIds.filter((x) => x.length > 0))];
  if (ids.length === 0) return {};
  // Capped at the number of distinct ids asked: a one-to-one match against
  // `.in()`, never a growing result set if a future caller ever asks for
  // more than today's one bounded caller (the record timeline's one page,
  // TIMELINE_PAGE_SIZE = 30 distinct person ids at most).
  const { data, error } = await db.from("users").select("clerk_user_id, name, email").in("clerk_user_id", ids).limit(ids.length);
  if (error) throw new Error(`listPeopleNames failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const u of (data ?? []) as { clerk_user_id: string; name: string | null; email: string }[]) {
    const label = u.name?.trim() || u.email;
    if (label) out[u.clerk_user_id] = label;
  }
  return out;
}
