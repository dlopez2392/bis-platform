import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The read-only MCP server's database seam (20261119152434_ai_apps.sql; docs/superpowers/plans/2026-11-19-mcp-server.md
 * sections 3.4 and 3.5). The switch is one per business and only its Owner moves it (D2): the caller checks the session
 * is an Owner of the account first, and the database refuses any other person (app.ai_apps_switch_record_guard).
 * Every wrapper THROWS on an error and on an answer it did not expect, naming itself; noteAiAppRead alone answers the
 * function's two refusals as values, because the route turns each into its own words.
 */
export const AI_APP_LOG_KINDS = ["ai_app_calls_and_messages", "ai_app_appointments", "ai_app_needs_attention",
  "ai_app_lookup_customer", "ai_app_my_businesses"] as const;
export type AiAppLogKind = (typeof AI_APP_LOG_KINDS)[number];

export type AiAppsSwitchState = { enabledAt: string | null; changedAt: string | null; changedBy: string | null };
export type AiAppRead = {
  accountId: string; actorClerkUserId: string; actorName: string | null; kind: AiAppLogKind; requestId: string;
};
export type AiAppReadResult = { ok: true; visitId: string } | { ok: false; reason: "not_allowed" | "rate_limited" };
export type AiAppLogRow = { who: string | null; kind: AiAppLogKind; at: string };

const SWITCH_COLS = "ai_apps_enabled_at, ai_apps_changed_at, ai_apps_changed_by";
type SwitchRow = { ai_apps_enabled_at: string | null; ai_apps_changed_at: string | null; ai_apps_changed_by: string | null };
const switchState = (r: SwitchRow): AiAppsSwitchState =>
  ({ enabledAt: r.ai_apps_enabled_at, changedAt: r.ai_apps_changed_at, changedBy: r.ai_apps_changed_by });

/** The function's own refusals (P0001, these exact words). Anything else is a failure, never a refusal. */
const REFUSALS: Record<string, "not_allowed" | "rate_limited"> = {
  "note_ai_app_read: not_allowed": "not_allowed",
  "note_ai_app_read: rate_limited": "rate_limited",
};

/**
 * Server code only, on serviceDb() (the function's one grantee). Writes one access-log visit and item for one tool
 * call, after the database re-checks the person's role, the business and the switch, and the limits. Call it BEFORE
 * the read's result leaves the server: a throw here fails the call (F-118 owner ruling 4).
 */
export async function noteAiAppRead(db: SupabaseClient, p: AiAppRead): Promise<AiAppReadResult> {
  const { data, error } = await db.rpc("note_ai_app_read", {
    p_account_id: p.accountId, p_actor: p.actorClerkUserId, p_actor_name: p.actorName, p_kind: p.kind,
    p_request_id: p.requestId,
  });
  if (error) {
    const reason = error.code === "P0001" ? REFUSALS[error.message] : undefined;
    if (reason) return { ok: false, reason };
    throw new Error(`noteAiAppRead failed: ${error.message}`);
  }
  if (typeof data === "string" && data !== "") return { ok: true, visitId: data };
  throw new Error(`noteAiAppRead: unexpected answer ${JSON.stringify(data)}`);
}

/** Server code only. An account that does not exist, or that the caller's RLS hides, THROWS: never an all-null "off". */
export async function readAiAppsSwitch(db: SupabaseClient, accountId: string): Promise<AiAppsSwitchState> {
  const { data, error } = await db.from("accounts").select(SWITCH_COLS).eq("id", accountId).maybeSingle();
  if (error) throw new Error(`readAiAppsSwitch failed: ${error.message}`);
  if (data === null) throw new Error(`readAiAppsSwitch: no such account ${accountId}`);
  return switchState(data as SwitchRow);
}

/**
 * Server code only, on serviceDb(), after the action checked the session is an Owner of this account (D2).
 * `changedByUserId` is that Owner's users.id; the database refuses anyone who is not (23514). The switch, a NEW change
 * time and the Owner travel in one UPDATE (the record trigger refuses a move without them). Asking for the state the
 * switch is already in writes NOTHING and answers `changed: false` (the UPDATE's own filter, so two clicks racing each
 * other change it once). The answer's state is the UPDATE's own row when it changed, and a re-read only on a no-op.
 */
export async function setAiAppsSwitch(
  db: SupabaseClient, accountId: string, on: boolean, changedByUserId: string,
): Promise<{ changed: boolean; state: AiAppsSwitchState }> {
  if (!changedByUserId) throw new Error("setAiAppsSwitch: changedByUserId is required");
  const at = new Date().toISOString();
  const base = db.from("accounts")
    .update({ ai_apps_enabled_at: on ? at : null, ai_apps_changed_at: at, ai_apps_changed_by: changedByUserId })
    .eq("id", accountId);
  const { data, error } = await (on ? base.is("ai_apps_enabled_at", null) : base.not("ai_apps_enabled_at", "is", null))
    .select(SWITCH_COLS);
  if (error) throw new Error(`setAiAppsSwitch failed: ${error.message}`);
  const rows = (data ?? []) as SwitchRow[];
  if (rows.length === 1) return { changed: true, state: switchState(rows[0]!) };
  const { data: now, error: readError } = await db.from("accounts").select(SWITCH_COLS).eq("id", accountId).maybeSingle();
  if (readError) throw new Error(`setAiAppsSwitch (no change) failed: ${readError.message}`);
  if (now === null) throw new Error(`setAiAppsSwitch: no such account ${accountId}`);
  return { changed: false, state: switchState(now as SwitchRow) };
}

/**
 * The last `limit` (1 to 100) AI-app reads on this business, newest first: who (the stored name, null when there was
 * none), which read, when. Kinds and times only, never what was read (D4). On the READER's request client: the access
 * log's RLS returns rows to the agency and this account's Owner only, [] to anyone else (plan 3.4: Owner only).
 * Two reads, visits then their items: each visit has exactly one item, written in the same transaction.
 */
export async function readAiAppLog(db: SupabaseClient, accountId: string, limit: number): Promise<AiAppLogRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("readAiAppLog: limit must be a whole number from 1 to 100");
  }
  const { data: visits, error } = await db.from("agency_visits").select("id, actor_name, started_at")
    .eq("account_id", accountId).eq("actor_kind", "ai_app")
    .order("started_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`readAiAppLog failed: ${error.message}`);
  const vs = (visits ?? []) as { id: string; actor_name: string | null; started_at: string }[];
  if (vs.length === 0) return [];
  const { data: items, error: itemsError } = await db.from("agency_visit_items").select("visit_id, kind")
    .eq("account_id", accountId).in("visit_id", vs.map((v) => v.id)).in("kind", [...AI_APP_LOG_KINDS]);
  if (itemsError) throw new Error(`readAiAppLog failed: ${itemsError.message}`);
  const kindOf = new Map(((items ?? []) as { visit_id: string; kind: AiAppLogKind }[]).map((i) => [i.visit_id, i.kind]));
  return vs.map((v) => {
    const kind = kindOf.get(v.id);
    if (!kind) throw new Error(`readAiAppLog: visit ${v.id} has no ai_app item`);
    return { who: v.actor_name, kind, at: v.started_at };
  });
}
