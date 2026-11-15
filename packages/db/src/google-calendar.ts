import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * S-22 slice 1 (migration google_calendar_connections): an account's link to its owner's Google Calendar.
 * Plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D5, D6, D12 and section 2.
 *
 * Server code only: the migration grants the table to service_role alone, so every caller passes `serviceDb()`
 * after its own `requireAccountAccess` (tenancy is the caller's job). Two reads, on purpose:
 *   - getGoogleConnectionStatus: what a card may show. Its column list leaves the ciphertext out, and it returns
 *     the row exactly as selected, so the list IS what leaves this module.
 *   - readGoogleConnectionSealed: the ONE reader of refresh_token_sealed, for the Google client alone.
 * Nothing here ever holds a refresh token in the clear: the caller's `seal` turns one into the stored value.
 * THROWS on a read or write error.
 */
const TABLE = "google_calendar_connections";

/** stampGoogleChecked writes last_checked_at at most this often, so a busy booking page is not a write per view. */
export const GOOGLE_CHECKED_STAMP_MINUTES = 10;
/** upsertGoogleConnection's compare-and-set retries before it gives up on a row that keeps changing. */
const UPSERT_ATTEMPTS = 3;

export type GoogleConnectionState = "connected" | "needs_reconnect";

/** The row a sealed token is bound to (token-seal's additional data): a copy on any other row does not open. */
export type GoogleConnectionRef = { accountId: string; id: string; version: number };

const STATUS_COLS =
  "id, account_id, version, google_email, scope, status, refresh_expires_at, connected_by, connected_at, " +
  "last_checked_at, needs_reconnect_since, reconnect_task_id";
export type GoogleConnectionStatus = {
  id: string; account_id: string; version: number; google_email: string; scope: string; status: GoogleConnectionState;
  refresh_expires_at: string | null; connected_by: string | null; connected_at: string; last_checked_at: string | null;
  needs_reconnect_since: string | null; reconnect_task_id: string | null;
};

const SEALED_COLS = "id, account_id, version, status, refresh_token_sealed, key_version";
export type GoogleConnectionSealed = {
  id: string; account_id: string; version: number; status: GoogleConnectionState;
  refresh_token_sealed: string; key_version: number;
};

/** The account's connection for display (no ciphertext), or null when it has none. */
export async function getGoogleConnectionStatus(db: SupabaseClient, accountId: string): Promise<GoogleConnectionStatus | null> {
  const { data, error } = await db.from(TABLE).select(STATUS_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getGoogleConnectionStatus failed: ${error.message}`);
  return (data as GoogleConnectionStatus | null) ?? null;
}

/** The sealed refresh token and the row it is bound to, or null. The only reader of the ciphertext. */
export async function readGoogleConnectionSealed(db: SupabaseClient, accountId: string): Promise<GoogleConnectionSealed | null> {
  const { data, error } = await db.from(TABLE).select(SEALED_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`readGoogleConnectionSealed failed: ${error.message}`);
  return (data as GoogleConnectionSealed | null) ?? null;
}

export type GoogleSealResult = { sealed: string; keyVersion: number };
export type GoogleConnectionWrite = {
  accountId: string;
  googleEmail: string;
  scope: string;
  refreshExpiresAt: Date | null;
  /** users.id of whoever connected, or null. */
  connectedBy: string | null;
  /** Seals the refresh token for exactly this row; called again if the row changed before the write landed. */
  seal: (ref: GoogleConnectionRef) => GoogleSealResult | Promise<GoogleSealResult>;
};

/**
 * Connect or reconnect. A first connect inserts version 1 under a fresh id; a reconnect keeps the id, bumps the
 * version, and clears the needs-reconnect state, the reconnect To-do's id and last_checked_at. The write is a
 * compare-and-set on the version it read, so a connect that lands meanwhile is never overwritten by a token sealed
 * for a version that no longer exists: it re-reads and seals again. `previousReconnectTaskId` is the To-do the
 * reconnect clears, for the caller to complete.
 */
export async function upsertGoogleConnection(
  db: SupabaseClient, w: GoogleConnectionWrite,
): Promise<{ id: string; version: number; previousReconnectTaskId: string | null }> {
  for (let attempt = 0; attempt < UPSERT_ATTEMPTS; attempt++) {
    const { data: cur, error: readErr } = await db.from(TABLE).select("id, version, reconnect_task_id")
      .eq("account_id", w.accountId).maybeSingle();
    if (readErr) throw new Error(`upsertGoogleConnection failed reading: ${readErr.message}`);
    const row = cur as { id: string; version: number; reconnect_task_id: string | null } | null;
    const ref: GoogleConnectionRef = row
      ? { accountId: w.accountId, id: row.id, version: row.version + 1 }
      : { accountId: w.accountId, id: randomUUID(), version: 1 };
    const { sealed, keyVersion } = await w.seal(ref);
    const fields = {
      version: ref.version, google_email: w.googleEmail, scope: w.scope, status: "connected",
      refresh_token_sealed: sealed, key_version: keyVersion,
      refresh_expires_at: w.refreshExpiresAt ? w.refreshExpiresAt.toISOString() : null,
      connected_by: w.connectedBy, connected_at: new Date().toISOString(),
      last_checked_at: null, needs_reconnect_since: null, reconnect_task_id: null,
    };
    if (!row) {
      const { error } = await db.from(TABLE).insert({ id: ref.id, account_id: w.accountId, ...fields });
      if (!error) return { id: ref.id, version: 1, previousReconnectTaskId: null };
      if (error.code === "23505") continue; // another first connect won; reconnect over it
      throw new Error(`upsertGoogleConnection failed inserting: ${error.message}`);
    }
    const { data: hit, error } = await db.from(TABLE).update(fields)
      .eq("id", row.id).eq("version", row.version).select("id");
    if (error) throw new Error(`upsertGoogleConnection failed updating: ${error.message}`);
    if ((hit ?? []).length === 1) return { id: row.id, version: ref.version, previousReconnectTaskId: row.reconnect_task_id };
  }
  throw new Error(`upsertGoogleConnection: the connection changed under every one of ${UPSERT_ATTEMPTS} attempts`);
}

/**
 * Google refused the token (invalid_grant): mark the connection needs_reconnect, but ONLY the version that was
 * read and only while it is still connected, so a reconnect that landed meanwhile survives and a second failure
 * marks nothing (D12). `"unchanged"` covers both.
 */
export async function markGoogleNeedsReconnect(db: SupabaseClient, id: string, version: number): Promise<"marked" | "unchanged"> {
  const { data, error } = await db.from(TABLE)
    .update({ status: "needs_reconnect", needs_reconnect_since: new Date().toISOString() })
    .eq("id", id).eq("version", version).eq("status", "connected").select("id");
  if (error) throw new Error(`markGoogleNeedsReconnect failed: ${error.message}`);
  return (data ?? []).length === 1 ? "marked" : "unchanged";
}

/** Record a successful Google read, unless one was recorded within GOOGLE_CHECKED_STAMP_MINUTES. True when written. */
export async function stampGoogleChecked(db: SupabaseClient, id: string, now: Date = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - GOOGLE_CHECKED_STAMP_MINUTES * 60_000).toISOString();
  const { data, error } = await db.from(TABLE).update({ last_checked_at: now.toISOString() })
    .eq("id", id).or(`last_checked_at.is.null,last_checked_at.lte."${cutoff}"`).select("id");
  if (error) throw new Error(`stampGoogleChecked failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Disconnect: delete the account's connection. The caller revokes at Google first (D4). */
export async function deleteGoogleConnection(db: SupabaseClient, accountId: string): Promise<"deleted" | "none"> {
  const { data, error } = await db.from(TABLE).delete().eq("account_id", accountId).select("id");
  if (error) throw new Error(`deleteGoogleConnection failed: ${error.message}`);
  return (data ?? []).length > 0 ? "deleted" : "none";
}
