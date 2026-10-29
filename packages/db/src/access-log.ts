import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * F-118 part 1 (0105): when BIS looked. A BIS (agency) person chooses a reason before entering an account,
 * which starts a visit; each record they open in it is written once to the visit's items.
 *
 * Who may call what (0105's grants):
 *   - startAgencyVisit, agencyVisitLive, noteAgencyOpen, newestAgencyVisitStart, readAgencyActorName take
 *     `serviceDb()`. Server code only; the account scope is the caller's job, and every one of them is given
 *     the account AND the person (and session) it is about.
 *   - readAccessLogPage takes the READER's request client (`dbForRequest()`): access_log_page is security
 *     invoker, so RLS bounds it to the agency or this account's Owner.
 * Every wrapper THROWS on an error and on any answer it did not expect, naming itself.
 */
export const AGENCY_VISIT_REASONS = ["setup", "support", "fix", "billing"] as const;
export type AgencyVisitReason = (typeof AGENCY_VISIT_REASONS)[number];
export function isAgencyVisitReason(v: unknown): v is AgencyVisitReason {
  return typeof v === "string" && (AGENCY_VISIT_REASONS as readonly string[]).includes(v);
}

export const ACCESS_LOG_KINDS = [
  "contact", "group", "call", "conversation", "document_view", "document_download", "document_share",
  "form_answers", "customer_list_export",
] as const;
export type AccessLogKind = (typeof ACCESS_LOG_KINDS)[number];
function isAccessLogKind(v: unknown): v is AccessLogKind {
  return typeof v === "string" && (ACCESS_LOG_KINDS as readonly string[]).includes(v);
}

export type OpenedRef =
  | { kind: Exclude<AccessLogKind, "customer_list_export">; recordId: string }
  | { kind: "customer_list_export"; itemCount: number };

/** Mirrors app.agency_visit_window(); pinned to 0105's text by access-log-schema.test.ts. */
export const AGENCY_VISIT_HOURS = 2;
export const ACCESS_LOG_PAGE_SIZE = 20;
/** Mirrors access_log_page's per-visit item cap (`limit 100`). */
export const ACCESS_LOG_ITEMS_SHOWN = 100;

export type AgencyActor = { clerkUserId: string; sessionId: string };

/** The live visit for this person, session and account, or a new one. `null`: no such account (23503). */
export async function startAgencyVisit(
  db: SupabaseClient, accountId: string, actor: AgencyActor & { name: string | null }, reason: AgencyVisitReason,
): Promise<string | null> {
  const { data, error } = await db.rpc("start_agency_visit", {
    p_account_id: accountId, p_actor: actor.clerkUserId, p_actor_name: actor.name,
    p_session: actor.sessionId, p_reason: reason,
  });
  if (error) {
    if (error.code === "23503") return null;
    throw new Error(`startAgencyVisit failed: ${error.message}`);
  }
  if (typeof data === "string") return data;
  throw new Error(`startAgencyVisit: unexpected answer ${JSON.stringify(data)}`);
}

/** The id of this person's live visit to this account in this session, or null. */
export async function agencyVisitLive(db: SupabaseClient, accountId: string, actor: AgencyActor): Promise<string | null> {
  const { data, error } = await db.rpc("agency_visit_live", {
    p_account_id: accountId, p_actor: actor.clerkUserId, p_session: actor.sessionId,
  });
  if (error) throw new Error(`agencyVisitLive failed: ${error.message}`);
  if (data === null || typeof data === "string") return data;
  throw new Error(`agencyVisitLive: unexpected answer ${JSON.stringify(data)}`);
}

/**
 * Write one opened record (or one customer-list download) to this person's live visit. `"no_visit"`: there
 * is none, and nothing was written. The database finds the visit itself; a caller can never name one.
 */
export async function noteAgencyOpen(
  db: SupabaseClient, accountId: string, actor: AgencyActor, ref: OpenedRef,
): Promise<"ok" | "no_visit"> {
  const { data, error } = await db.rpc("note_agency_open", {
    p_account_id: accountId, p_actor: actor.clerkUserId, p_session: actor.sessionId, p_kind: ref.kind,
    p_record_id: ref.kind === "customer_list_export" ? null : ref.recordId,
    p_item_count: ref.kind === "customer_list_export" ? ref.itemCount : null,
  });
  if (error) throw new Error(`noteAgencyOpen failed: ${error.message}`);
  if (data === "ok" || data === "no_visit") return data;
  throw new Error(`noteAgencyOpen: unexpected answer ${JSON.stringify(data)}`);
}

/** When this person's newest visit to this account in this session started (live or not), or null. */
export async function newestAgencyVisitStart(db: SupabaseClient, accountId: string, actor: AgencyActor): Promise<string | null> {
  const { data, error } = await db.from("agency_visits").select("started_at")
    .eq("account_id", accountId).eq("actor_clerk_user_id", actor.clerkUserId).eq("clerk_session_id", actor.sessionId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`newestAgencyVisitStart failed: ${error.message}`);
  if (data === null) return null;
  const startedAt = (data as { started_at?: unknown }).started_at;
  if (typeof startedAt === "string") return startedAt;
  throw new Error("newestAgencyVisitStart: unexpected answer");
}

/** The BIS person's stored name and email, by Clerk user id, or null when there is no users row. */
export async function readAgencyActorName(
  db: SupabaseClient, clerkUserId: string,
): Promise<{ name: string | null; email: string | null } | null> {
  const { data, error } = await db.from("users").select("name, email").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readAgencyActorName failed: ${error.message}`);
  if (data === null) return null;
  const r = data as { name?: unknown; email?: unknown };
  const str = (v: unknown) => (v === null || typeof v === "string");
  if (str(r.name) && str(r.email)) return { name: r.name as string | null, email: r.email as string | null };
  throw new Error("readAgencyActorName: unexpected answer");
}

export type AccessLogCounts = {
  contact: number; group: number; call: number; conversation: number; file: number; form_answers: number;
  customer_list_export: number;
};
export type AccessLogItem = { kind: AccessLogKind; recordId: string | null; itemCount: number | null; firstOpenedAt: string };
export type AccessLogVisit = {
  id: string; actorName: string | null; reason: AgencyVisitReason; startedAt: string; endedAt: string | null;
  counts: AccessLogCounts; itemTotal: number; items: AccessLogItem[];
};
export type AccessLogPage = { total: number; visits: AccessLogVisit[]; hasOlder: boolean };
export type AccessLogCursor = { startedAt: string; id: string };

/** One page of the account's visits, newest first, older than `before`. Takes the READER's client. */
export async function readAccessLogPage(
  db: SupabaseClient, accountId: string, before: AccessLogCursor | null, limit: number = ACCESS_LOG_PAGE_SIZE,
): Promise<AccessLogPage> {
  const { data, error } = await db.rpc("access_log_page", {
    p_account_id: accountId, p_before_started: before?.startedAt ?? null, p_before_id: before?.id ?? null, p_limit: limit,
  });
  if (error) throw new Error(`readAccessLogPage failed: ${error.message}`);
  return parseAccessLogPage(data, limit);
}

const COUNT_KEYS = ["contact", "group", "call", "conversation", "file", "form_answers", "customer_list_export"] as const;

function bad(what: string): never {
  throw new Error(`parseAccessLogPage: unexpected ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

function parseItem(raw: unknown): AccessLogItem {
  if (!isObj(raw)) bad("item");
  if (!isAccessLogKind(raw.kind)) bad("item kind");
  if (!strOrNull(raw.record_id)) bad("item record_id");
  if (!(raw.item_count === null || isNum(raw.item_count))) bad("item item_count");
  if (typeof raw.first_opened_at !== "string") bad("item first_opened_at");
  return { kind: raw.kind, recordId: raw.record_id, itemCount: raw.item_count as number | null, firstOpenedAt: raw.first_opened_at };
}

function parseVisit(raw: unknown): AccessLogVisit {
  if (!isObj(raw)) bad("visit");
  if (typeof raw.id !== "string") bad("visit id");
  if (!strOrNull(raw.actor_name)) bad("visit actor_name");
  if (!isAgencyVisitReason(raw.reason)) bad("visit reason");
  if (typeof raw.started_at !== "string") bad("visit started_at");
  if (!strOrNull(raw.ended_at)) bad("visit ended_at");
  if (!isNum(raw.item_total)) bad("visit item_total");
  if (!Array.isArray(raw.items)) bad("visit items");
  const c = raw.counts;
  if (!isObj(c)) bad("visit counts");
  const counts = {} as AccessLogCounts;
  for (const k of COUNT_KEYS) {
    const n = c[k];
    if (!isNum(n)) bad(`count ${k}`);
    counts[k] = n;
  }
  return {
    id: raw.id, actorName: raw.actor_name, reason: raw.reason, startedAt: raw.started_at, endedAt: raw.ended_at,
    counts, itemTotal: raw.item_total, items: raw.items.map(parseItem),
  };
}

/** access_log_page's jsonb to the typed page: `limit + 1` visits mean there are older ones; keeps `limit`. */
export function parseAccessLogPage(raw: unknown, limit: number): AccessLogPage {
  if (!isObj(raw)) bad("page");
  if (!isNum(raw.total)) bad("total");
  if (!Array.isArray(raw.visits)) bad("visits");
  const visits = raw.visits.map(parseVisit);
  return { total: raw.total, visits: visits.slice(0, limit), hasOlder: visits.length > limit };
}
