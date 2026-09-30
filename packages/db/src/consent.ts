import type { SupabaseClient } from "@supabase/supabase-js";
export { emailLedgerAddress } from "./email-address";

/**
 * The consent ledger (0054, consent chain spec §3): append-only, per
 * account, keyed on the normalised address (E.164 for SMS, the lowercased
 * address for email). THE ONLY MODULE THAT NAMES `consent_events` OR ITS
 * WRITE FUNCTION (source scan 3, apps/web's lib/consent/scans.test.ts).
 *
 * From PR-2 every write goes through `public.append_consent_event` (0055):
 * under a per-address lock it reads the newest deciding row, applies the
 * caller's guard and spec §3's two rules, and inserts. No role holds UPDATE
 * or DELETE on the table.
 */
export type ConsentChannel = "sms" | "email";
export type ConsentAction = "granted" | "revoked" | "held" | "hold_released" | "resubscribed";
export const CONSENT_METHODS = [
  "keyword", "start_keyword", "free_text", "staff", "staff_undo", "carrier_block",
  "unsubscribe_link", "one_click", "unsubscribe_page", "form", "booking", "inbound_text",
  "backfill_0049", "backfill_telnyx",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/** The rows that decide the state. `granted` is evidence only and never does (choice 28). */
export const DECIDING_ACTIONS = ["revoked", "held", "hold_released", "resubscribed"] as const satisfies readonly ConsentAction[];

type DecidingAction = (typeof DECIDING_ACTIONS)[number];

/** On an `occurred_at` tie the more restrictive row wins: a stop outranks a
 *  hold, a hold outranks a lift. Never the uuid's accident (review R1-M2).
 *  0055's function orders by the same three keys. */
const RESTRICTIVENESS: Record<DecidingAction, number> = { revoked: 3, held: 2, hold_released: 1, resubscribed: 1 };

/** How many of an address's newest deciding rows a read takes: every row that
 *  shares the newest instant, with room to spare. */
const NEWEST_ROWS = 20;

/** The ledger's write function (0055). Named here and nowhere else. */
const WRITE_FUNCTION = "append_consent_event";

export type ConsentRow = {
  id: string; action: ConsentAction; method: ConsentMethod; occurred_at: string;
};

export type ConsentState =
  | { state: "allowed" }
  | { state: "stopped"; since: string; method: ConsentMethod; eventId: string }
  | { state: "held"; since: string; method: ConsentMethod; eventId: string };

/**
 * The newest DECIDING row: `occurred_at` compared as instants (Date.parse,
 * millisecond precision), then the more restrictive action, then the larger
 * id. `granted` rows are skipped wherever they sort. 0055's function orders
 * by the same keys, truncating `occurred_at` to the millisecond, so the two
 * can never disagree about which row is newest.
 */
export function newestDecidingRow<T extends ConsentRow>(rows: readonly T[]): T | null {
  const deciding = rows.filter((r) => (DECIDING_ACTIONS as readonly string[]).includes(r.action));
  deciding.sort((a, b) => {
    const t = Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    if (t !== 0) return t;
    const r = RESTRICTIVENESS[b.action as DecidingAction] - RESTRICTIVENESS[a.action as DecidingAction];
    return r !== 0 ? r : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
  return deciding[0] ?? null;
}

/**
 * Spec §3's table, pure: none / `hold_released` / `resubscribed` → allowed;
 * `revoked` → stopped; `held` → held. Compared as instants, never as strings:
 * PostgREST and a backfill can spell the same moment differently.
 */
export function consentStateOf(rows: readonly ConsentRow[]): ConsentState {
  const newest = newestDecidingRow(rows);
  if (!newest || newest.action === "hold_released" || newest.action === "resubscribed") return { state: "allowed" };
  return {
    state: newest.action === "revoked" ? "stopped" : "held",
    since: newest.occurred_at, method: newest.method, eventId: newest.id,
  };
}

/**
 * One address's state. THROWS on a read error: the send gate turns that into
 * `blocked: ledger_unavailable` (fails closed, §4.1).
 */
export async function readConsentState(
  db: SupabaseClient, accountId: string, channel: ConsentChannel, address: string,
): Promise<ConsentState> {
  const { data, error } = await db.from("consent_events")
    .select("id, action, method, occurred_at")
    .eq("account_id", accountId).eq("channel", channel).eq("address", address)
    .in("action", [...DECIDING_ACTIONS])
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .limit(NEWEST_ROWS);
  if (error) throw new Error(`readConsentState failed: ${error.message}`);
  return consentStateOf((data ?? []) as ConsentRow[]);
}

/** One PostgREST page. A chunk that fills it is refused, never judged on. */
const BLOCKED_PAGE = 1000;
/** Addresses per read, so a page of candidates stays a short request. */
const BLOCKED_CHUNK = 100;

/**
 * Which of these addresses are NOT allowed (stopped, or held), each in its
 * own account: the keys `${accountId}|${address}`. For the due-lists that
 * must leave a stopped customer out of the WALK itself rather than skip it
 * in a pass (the reactivation walk, the #118 I1 trap). THROWS on a read
 * error, and on a chunk that fills a whole page: the caller's walk then
 * fails, and nothing is sent on a guess (fails closed, spec §5).
 */
export async function readBlockedAddresses(
  db: SupabaseClient, channel: ConsentChannel, pairs: readonly { accountId: string; address: string }[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (pairs.length === 0) return blocked;
  const accountIds = [...new Set(pairs.map((p) => p.accountId))];
  const addresses = [...new Set(pairs.map((p) => p.address))];
  const byKey = new Map<string, ConsentRow[]>();
  for (let i = 0; i < addresses.length; i += BLOCKED_CHUNK) {
    const { data, error } = await db.from("consent_events")
      .select("id, account_id, address, action, method, occurred_at")
      .in("account_id", accountIds).eq("channel", channel)
      .in("address", addresses.slice(i, i + BLOCKED_CHUNK))
      .in("action", [...DECIDING_ACTIONS])
      .limit(BLOCKED_PAGE);
    if (error) throw new Error(`readBlockedAddresses failed: ${error.message}`);
    const rows = (data ?? []) as (ConsentRow & { account_id: string; address: string })[];
    if (rows.length >= BLOCKED_PAGE) throw new Error(`readBlockedAddresses: a chunk returned ${BLOCKED_PAGE} rows, the whole page; refusing to judge on it`);
    for (const r of rows) {
      const key = `${r.account_id}|${r.address}`;
      const list = byKey.get(key);
      if (list) list.push(r); else byKey.set(key, [r]);
    }
  }
  for (const p of pairs) {
    const key = `${p.accountId}|${p.address}`;
    if (consentStateOf(byKey.get(key) ?? []).state !== "allowed") blocked.add(key);
  }
  return blocked;
}

/** A deciding row with what the Texts row and the staff actions show and check. */
export type ConsentHistoryRow = ConsentRow & {
  evidence: Record<string, unknown>; note: string | null; actor_id: string | null;
};

/** The same newest deciding rows as `readConsentState`, WITH evidence, note and actor. THROWS on a read error. */
export async function readConsentHistory(
  db: SupabaseClient, accountId: string, channel: ConsentChannel, address: string,
): Promise<ConsentHistoryRow[]> {
  const { data, error } = await db.from("consent_events")
    .select("id, action, method, occurred_at, evidence, note, actor_id")
    .eq("account_id", accountId).eq("channel", channel).eq("address", address)
    .in("action", [...DECIDING_ACTIONS])
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .limit(NEWEST_ROWS);
  if (error) throw new Error(`readConsentHistory failed: ${error.message}`);
  return (data ?? []) as ConsentHistoryRow[];
}

export type ConsentEventRow = ConsentHistoryRow & {
  channel: ConsentChannel; address: string; contact_id: string | null;
};

/** One row, by account AND id (another account's id reads nothing). THROWS on a read error. */
export async function readConsentEvent(
  db: SupabaseClient, accountId: string, id: string,
): Promise<ConsentEventRow | null> {
  const { data, error } = await db.from("consent_events")
    .select("id, action, method, occurred_at, evidence, note, actor_id, channel, address, contact_id")
    .eq("account_id", accountId).eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`readConsentEvent failed: ${error.message}`);
  return (data as ConsentEventRow | null) ?? null;
}

/** Each row's action, by id, for the To-do rows that link one (work-queue.ts). No ids, no read. */
export async function readConsentActions(
  db: SupabaseClient, accountId: string, ids: readonly string[],
): Promise<Map<string, ConsentAction>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("consent_events")
    .select("id, action")
    .eq("account_id", accountId).in("id", [...ids]);
  if (error) throw new Error(`readConsentActions failed: ${error.message}`);
  return new Map(((data ?? []) as { id: string; action: ConsentAction }[]).map((r) => [r.id, r.action]));
}

export type ConsentEventInput = {
  accountId: string;
  channel: ConsentChannel;
  address: string;
  action: ConsentAction;
  method: ConsentMethod;
  contactId?: string | null;
  actorId?: string | null;
  note?: string | null;
  sourceRef?: string | null;
  evidence?: Record<string, unknown>;
  occurredAt?: string;
};

/**
 * The guard the function applies inside its lock:
 * - `none`: always (spec §3's two rules still apply);
 * - `if_empty`: the address has no row at all, a grant included (the first-text grant);
 * - `unless_customer_stopped`: the newest deciding row is not the CUSTOMER'S OWN stop
 *   (`CUSTOMER_STOP_METHODS`). A staff stop or a confirmed free-text stop does not
 *   refuse it: the customer's STOP is recorded over it, so only the customer can
 *   lift it (choice 19; danlo 2026-09-28);
 * - `if_allowed`: no deciding row, or a lift (a free-text hold);
 * - `if_stopped_or_held`: a stop or a hold (START);
 * - `{ ifNewest }`: the newest deciding row is exactly this one, `null` meaning
 *   there is none (every staff action: a stale click is refused, never applied).
 */
export type ConsentGuard =
  | "none" | "if_empty" | "unless_customer_stopped" | "if_allowed" | "if_stopped_or_held"
  | { ifNewest: string | null };

/** The stops only the customer can lift (choice 19). 0055's `unless_customer_stopped` carries the same list. */
export const CUSTOMER_STOP_METHODS: readonly ConsentMethod[] = ["keyword", "carrier_block", "backfill_telnyx", "unsubscribe_link", "one_click"];

export type PriorDecidingRow = {
  id: string; action: ConsentAction; method: ConsentMethod; evidence: Record<string, unknown>;
};

export type ConsentAppend =
  | { outcome: "appended"; id: string; prior: PriorDecidingRow | null }
  | { outcome: "duplicate"; id: string }
  | { outcome: "refused"; prior: PriorDecidingRow | null };

type WriteAnswer = {
  outcome: string; event_id: string | null;
  prior_id: string | null; prior_action: ConsentAction | null; prior_method: ConsentMethod | null;
  prior_evidence: Record<string, unknown> | null;
};

function assertOccurredAt(occurredAt: string | undefined): void {
  // The table's own CHECK (consent_events_occurred_at_sane) refuses a future
  // or infinite occurred_at too, but only after a round trip; refuse here,
  // without writing, the moment it cannot even parse to a finite instant.
  if (occurredAt !== undefined && !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error(`appendConsentEvent: occurredAt does not parse to a finite date: ${occurredAt}`);
  }
}

/** The function's thirteen arguments, by name (PostgREST matches on the names). */
export function consentWriteArgs(e: ConsentEventInput, guard: ConsentGuard): Record<string, unknown> {
  return {
    p_account_id: e.accountId, p_channel: e.channel, p_address: e.address,
    p_action: e.action, p_method: e.method,
    p_guard: typeof guard === "string" ? guard : "if_newest",
    p_expect_id: typeof guard === "string" ? null : guard.ifNewest,
    p_contact_id: e.contactId ?? null, p_actor_id: e.actorId ?? null, p_note: e.note ?? null,
    p_source_ref: e.sourceRef ?? null, p_evidence: e.evidence ?? {}, p_occurred_at: e.occurredAt ?? null,
  };
}

/** THE write. THROWS on an RPC error or an answer it does not know: a write is never assumed. */
export async function appendConsentEventGuarded(
  db: SupabaseClient, e: ConsentEventInput, guard: ConsentGuard,
): Promise<ConsentAppend> {
  assertOccurredAt(e.occurredAt);
  const { data, error } = await db.rpc(WRITE_FUNCTION, consentWriteArgs(e, guard));
  if (error) throw new Error(`append_consent_event failed: ${error.message}`);
  const answer = (Array.isArray(data) ? data[0] : data) as WriteAnswer | undefined;
  if (!answer) throw new Error("append_consent_event returned no row");
  const prior: PriorDecidingRow | null = answer.prior_id && answer.prior_action && answer.prior_method
    ? { id: answer.prior_id, action: answer.prior_action, method: answer.prior_method, evidence: answer.prior_evidence ?? {} }
    : null;
  if (answer.outcome === "appended" && answer.event_id) return { outcome: "appended", id: answer.event_id, prior };
  if (answer.outcome === "duplicate" && answer.event_id) return { outcome: "duplicate", id: answer.event_id };
  if (answer.outcome === "refused") return { outcome: "refused", prior };
  throw new Error(`append_consent_event: unexpected answer ${JSON.stringify(answer.outcome)}`);
}

/**
 * An unguarded append (guard `none`), for the writers that need no guard: the
 * PR-1 live test and grants. `hold_released` is refused outright: it is
 * written only by `appendConsentEventGuarded` with `{ ifNewest: <the hold> }`.
 * THROWS when the function refused (spec §3's rules still apply).
 */
export async function appendConsentEvent(db: SupabaseClient, e: ConsentEventInput): Promise<{ id: string }> {
  if (e.action === "hold_released") {
    throw new Error("appendConsentEvent: hold_released is written only by appendConsentEventGuarded with { ifNewest: <the held row> }");
  }
  const r = await appendConsentEventGuarded(db, e, "none");
  if (r.outcome === "refused") {
    throw new Error(`appendConsentEvent: refused (${e.action} after ${r.prior?.action ?? "no row"})`);
  }
  return { id: r.id };
}

/**
 * The carrier refused a send because the number opted out (gate step 9).
 * Appends `revoked` / `carrier_block` unless the address is ALREADY stopped,
 * decided inside the function's lock, so two refusals at once write one row.
 */
export async function recordCarrierBlock(
  db: SupabaseClient,
  input: { accountId: string; address: string; contactId: string | null; kind: string },
): Promise<"appended" | "already_stopped"> {
  const r = await appendConsentEventGuarded(db, {
    accountId: input.accountId, channel: "sms", address: input.address,
    action: "revoked", method: "carrier_block", contactId: input.contactId,
    evidence: { kind: input.kind },
  }, "unless_customer_stopped");
  return r.outcome === "appended" ? "appended" : "already_stopped";
}

/**
 * The same write as ONE SQL statement, for a one-off backfill the
 * orchestrator runs through the Supabase MCP (never the app). Every value is
 * a typed literal with its quotes doubled; a statement that would carry a
 * backslash is refused, because the MCP mangles backslash escapes (memory
 * bis-mcp-sql-escapes).
 */
export function consentAppendSql(e: ConsentEventInput, guard: ConsentGuard): string {
  assertOccurredAt(e.occurredAt);
  const a = consentWriteArgs(e, guard);
  const lit = (v: unknown, type: string) =>
    v === null || v === undefined ? `null::${type}` : `'${(typeof v === "string" ? v : JSON.stringify(v)).split("'").join("''")}'::${type}`;
  const sql = `select outcome, event_id from public.${WRITE_FUNCTION}(` + [
    lit(a.p_account_id, "uuid"), lit(a.p_channel, "text"), lit(a.p_address, "text"), lit(a.p_action, "text"),
    lit(a.p_method, "text"), lit(a.p_guard, "text"), lit(a.p_expect_id, "uuid"), lit(a.p_contact_id, "uuid"),
    lit(a.p_actor_id, "text"), lit(a.p_note, "text"), lit(a.p_source_ref, "text"), lit(a.p_evidence, "jsonb"),
    lit(a.p_occurred_at, "timestamptz"),
  ].join(", ") + ");";
  if (sql.includes(String.fromCharCode(0x5c))) throw new Error("consentAppendSql: a value carries a backslash, which the MCP would mangle");
  return sql;
}
