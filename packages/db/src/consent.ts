import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The consent ledger (0054, consent chain spec §3): append-only, per
 * account, keyed on the normalised address (E.164 for SMS, the lowercased
 * address for email). THE ONLY MODULE THAT WRITES `consent_events` (source
 * scan 3, apps/web's lib/consent/scans.test.ts); every write is the service
 * role's, and no role holds UPDATE or DELETE on the table.
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
 *  hold, a hold outranks a lift. Never the uuid's accident (review R1-M2). */
const RESTRICTIVENESS: Record<DecidingAction, number> = { revoked: 3, held: 2, hold_released: 1, resubscribed: 1 };

/** How many of an address's newest deciding rows a read takes: every row that
 *  shares the newest instant, with room to spare. */
const NEWEST_ROWS = 20;

export type ConsentRow = {
  id: string; action: ConsentAction; method: ConsentMethod; occurred_at: string;
};

export type ConsentState =
  | { state: "allowed" }
  | { state: "stopped"; since: string; method: ConsentMethod; eventId: string }
  | { state: "held"; since: string; method: ConsentMethod; eventId: string };

/**
 * Spec §3's table, pure. The newest DECIDING row decides; on an
 * `occurred_at` tie the most restrictive one (revoked, then held, then a
 * lift), and only then the larger `id`: none / `hold_released` / `resubscribed` →
 * allowed; `revoked` → stopped; `held` → held. `granted` rows are skipped
 * wherever they sort. Compared as instants, never as strings: PostgREST and
 * a backfill can spell the same moment differently.
 */
export function consentStateOf(rows: readonly ConsentRow[]): ConsentState {
  const deciding = rows.filter((r) => (DECIDING_ACTIONS as readonly string[]).includes(r.action));
  deciding.sort((a, b) => {
    const t = Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    if (t !== 0) return t;
    const r = RESTRICTIVENESS[b.action as DecidingAction] - RESTRICTIVENESS[a.action as DecidingAction];
    return r !== 0 ? r : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
  const newest = deciding[0];
  if (!newest || newest.action === "hold_released" || newest.action === "resubscribed") return { state: "allowed" };
  return {
    state: newest.action === "revoked" ? "stopped" : "held",
    since: newest.occurred_at, method: newest.method, eventId: newest.id,
  };
}

/**
 * One address's state. Reads the address's newest deciding rows (the index
 * `consent_events_address_idx` serves it) and lets `consentStateOf` decide,
 * so an `occurred_at` tie is broken by restrictiveness, not by the uuid. THROWS on a read error: the send
 * gate turns that into `blocked: ledger_unavailable` (fails closed, §4.1).
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

/** The one INSERT into the ledger. The table's CHECKs refuse a bad shape. */
export async function appendConsentEvent(db: SupabaseClient, e: ConsentEventInput): Promise<{ id: string }> {
  // Spec §3: "A hold_released row is written only when the state is held",
  // checked inside the insert. That guarded write is PR-2's; until it exists
  // nothing may append one (a plain insert could lift a stop, review R1-M3).
  if (e.action === "hold_released") {
    throw new Error("appendConsentEvent: hold_released needs PR-2's guarded write (only while the state is held)");
  }
  const { data, error } = await db.from("consent_events").insert({
    account_id: e.accountId, channel: e.channel, address: e.address,
    action: e.action, method: e.method,
    contact_id: e.contactId ?? null, actor_id: e.actorId ?? null, note: e.note ?? null,
    source_ref: e.sourceRef ?? null, evidence: e.evidence ?? {},
    ...(e.occurredAt ? { occurred_at: e.occurredAt } : {}),
  }).select("id").single();
  if (error || !data) throw new Error(`appendConsentEvent failed: ${error?.message ?? "no row"}`);
  return { id: (data as { id: string }).id };
}

/**
 * The carrier refused a send because the number opted out (gate step 9).
 * Appends `revoked` / `carrier_block` unless the address is ALREADY stopped
 * (spec §4.3's idempotency rule, applied here too). Read-then-insert, not
 * atomic: two refused sends at once can both append, which leaves the same
 * state (stopped) and is harmless.
 */
export async function recordCarrierBlock(
  db: SupabaseClient,
  input: { accountId: string; address: string; contactId: string | null; kind: string },
): Promise<"appended" | "already_stopped"> {
  const now = await readConsentState(db, input.accountId, "sms", input.address);
  if (now.state === "stopped") return "already_stopped";
  await appendConsentEvent(db, {
    accountId: input.accountId, channel: "sms", address: input.address,
    action: "revoked", method: "carrier_block", contactId: input.contactId,
    evidence: { kind: input.kind },
  });
  return "appended";
}
