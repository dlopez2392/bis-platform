import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyHours } from "./voice";

/** 0095. The TypeScript twin of voice_services_price_kind_check. */
export type PriceKind = "fixed" | "from" | "range" | "per_unit" | "free" | "after_visit";
export type VoiceServiceInput = {
  name_en: string; name_es: string | null; description_en: string | null; description_es: string | null;
  price_kind: PriceKind; amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};
export type VoiceServiceRow = VoiceServiceInput & { id: string; account_id: string; position: number; created_at: string };
export type KnowledgeSnapshotRow = { id: string; account_id: string; version: number; payload: unknown; created_at: string; created_by: string };
export type KnowledgeParts = { facts?: string; services_text?: string; business_hours?: WeeklyHours | null; services?: VoiceServiceInput[] };
export type SaveKnowledgeResult = { status: "ok"; version: number } | { status: "stale" | "no_profile" | "invalid" };

// LOAD-BEARING (0095): every one of these names a 0095 table or function; a project without 0095 refuses them.
const SERVICE_COLS =
  "id, account_id, position, name_en, name_es, description_en, description_es, price_kind, amount_cents, amount_max_cents, unit_en, unit_es, created_at";

/** The price list, in its order. RLS-safe on a user client (Owners and the agency read; spec 4). */
export async function listVoiceServices(db: SupabaseClient, accountId: string): Promise<VoiceServiceRow[]> {
  const { data, error } = await db.from("voice_services").select(SERVICE_COLS)
    .eq("account_id", accountId).order("position", { ascending: true });
  if (error) throw new Error(`listVoiceServices failed: ${error.message}`);
  return (data ?? []) as VoiceServiceRow[];
}

/** One numbered snapshot of this account, or null when it holds none by that number. */
export async function getKnowledgeSnapshot(db: SupabaseClient, accountId: string, version: number): Promise<KnowledgeSnapshotRow | null> {
  const { data, error } = await db.from("voice_knowledge_snapshots")
    .select("id, account_id, version, payload, created_at, created_by")
    .eq("account_id", accountId).eq("version", version).maybeSingle();
  if (error) throw new Error(`getKnowledgeSnapshot failed: ${error.message}`);
  return (data as KnowledgeSnapshotRow | null) ?? null;
}

/** The latest version, 0 when the account has none. A row read, never a head count (memory "Head-count null"). */
export async function getLatestKnowledgeVersion(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.from("voice_knowledge_snapshots").select("version")
    .eq("account_id", accountId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`getLatestKnowledgeVersion failed: ${error.message}`);
  return (data as { version: number } | null)?.version ?? 0;
}

/**
 * Every Voice page knowledge save, through 0095's save_voice_knowledge (service_role only: call it with
 * serviceDb() behind the app's agency check). A refusal is a status, never a throw; a transport error throws.
 */
export async function saveVoiceKnowledge(db: SupabaseClient, accountId: string,
  input: { actor: string; parts: KnowledgeParts; payload: Record<string, unknown>; baseVersion: number },
): Promise<SaveKnowledgeResult> {
  const { data, error } = await db.rpc("save_voice_knowledge", {
    p_account_id: accountId, p_actor: input.actor, p_parts: input.parts, p_payload: input.payload, p_base_version: input.baseVersion,
  });
  if (error) throw new Error(`saveVoiceKnowledge failed: ${error.message}`);
  const r = data as { status?: unknown; version?: unknown } | null;
  if (r?.status === "ok" && typeof r.version === "number") return { status: "ok", version: r.version };
  if (r?.status === "stale" || r?.status === "no_profile" || r?.status === "invalid") return { status: r.status };
  throw new Error("saveVoiceKnowledge failed: an answer the function never gives");
}

/** Call and chat start (spec 5.6). The callers fail open: a throw leaves the call or chat unstamped. */
export async function ensureKnowledgeSnapshot(db: SupabaseClient, accountId: string, payload: Record<string, unknown>): Promise<number> {
  const { data, error } = await db.rpc("ensure_knowledge_snapshot", { p_account_id: accountId, p_payload: payload });
  if (error) throw new Error(`ensureKnowledgeSnapshot failed: ${error.message}`);
  if (typeof data !== "number" || !Number.isInteger(data) || data < 1) throw new Error("ensureKnowledgeSnapshot failed: not a version");
  return data;
}
