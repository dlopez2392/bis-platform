import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Heartbeats (0057, docs/superpowers/specs/2026-10-01-operational-floor-design.md
 * section 1): one `ops_heartbeats` row per moving part of the platform, written
 * by the cron harness and the webhook routes, read by the alert pass and the
 * health route. service_role only: the table grants anon and authenticated
 * nothing, so every caller passes `serviceDb()`.
 */

/** The fixed keys the spec names. A cron pass's key is `passHeartbeatKey(pass.key)`. */
export const HEARTBEAT_KEYS = {
  cronTick: "cron.tick",
  voiceTexml: "voice.texml",
  voiceSipWebhook: "voice.sip_webhook",
  emailResendWebhook: "email.resend_webhook",
  smsInbound: "sms.inbound",
  stripeWebhook: "stripe.webhook",
} as const;

/** `cron.pass.<pass key>`, the pass key verbatim (camelCase, e.g. `weeklyAgencyReport`). */
export function passHeartbeatKey(passKey: string): string {
  return `cron.pass.${passKey}`;
}

/**
 * TWIN of 0057's `ops_heartbeats_key_check` (`key ~ '^[A-Za-z0-9_.-]{1,80}$'`).
 * Upper case is allowed because pass keys are camelCase. JS's `$` (no `m`
 * flag) and Postgres ARE's `$` both match only at the very end, so a trailing
 * newline is refused on both sides; ops-heartbeats-schema.test.ts pins the
 * agreement against the live CHECK, literal by literal.
 */
export const HEARTBEAT_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

export function isHeartbeatKey(key: string): boolean {
  return HEARTBEAT_KEY_PATTERN.test(key);
}

/** The most `last_error` holds (0057's CHECK and record_heartbeat's `left(p_error, 300)`). */
export const HEARTBEAT_ERROR_MAX_CHARS = 300;

/**
 * What is sent as `p_error`. Postgres cuts to 300 CHARACTERS (code points)
 * itself; this cuts by code point too, so a long stack never travels whole
 * and an astral character at the boundary is never split into a lone
 * surrogate (`String.prototype.slice` counts UTF-16 units and would). NUL is
 * dropped first: Postgres text cannot hold it, and a `\u0000` in the RPC's
 * JSON fails the whole call ("unsupported Unicode escape sequence"), which
 * would lose the heartbeat rather than its text.
 */
export function boundHeartbeatError(error: string): string {
  return Array.from(error.replace(/\u0000/g, "")).slice(0, HEARTBEAT_ERROR_MAX_CHARS).join("");
}

export type HeartbeatRow = {
  key: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  alertedAt: string | null;
};

/**
 * Stamps one heartbeat through `public.record_heartbeat` (0057): ok resets
 * `consecutive_failures` to 0 and stamps `last_ok_at`; an error stamps
 * `last_error_at`, keeps the first 300 characters of `error`, and adds one
 * to `consecutive_failures` atomically. `alerted_at` is never touched here.
 *
 * NEVER THROWS, and never rejects: its callers are webhook routes (Telnyx's
 * TeXML fetch has a hard timeout) and the cron harness, and a heartbeat that
 * fails must never fail the thing it reports on. A failure is one
 * console.error line naming the key. `error` must never carry a token, an
 * address or a phone number (spec section 1); that is the caller's to keep
 * out, this only bounds its length.
 */
export async function recordHeartbeat(
  db: SupabaseClient, key: string, outcome: { ok: true } | { ok: false; error: string },
): Promise<void> {
  try {
    if (!isHeartbeatKey(key)) {
      console.error(`recordHeartbeat: ${JSON.stringify(key)} is not a heartbeat key (0057's ops_heartbeats_key_check); nothing written`);
      return;
    }
    const { error } = await db.rpc("record_heartbeat", {
      p_key: key,
      p_ok: outcome.ok,
      p_error: outcome.ok ? null : boundHeartbeatError(String(outcome.error)),
    });
    if (error) console.error(`recordHeartbeat(${key}) failed: ${error.message}`);
  } catch (e) {
    console.error(`recordHeartbeat(${key}) failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

type HeartbeatDbRow = {
  key: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null;
  consecutive_failures: number; alerted_at: string | null;
};

const HEARTBEAT_COLS = "key, last_ok_at, last_error_at, last_error, consecutive_failures, alerted_at";

/** Every heartbeat, by key. Throws on a read error (the alert pass and the health route catch). */
export async function listHeartbeats(db: SupabaseClient): Promise<HeartbeatRow[]> {
  const { data, error } = await db.from("ops_heartbeats").select(HEARTBEAT_COLS).order("key", { ascending: true });
  if (error) throw new Error(`listHeartbeats failed: ${error.message}`);
  return ((data ?? []) as HeartbeatDbRow[]).map((r) => ({
    key: r.key,
    lastOkAt: r.last_ok_at,
    lastErrorAt: r.last_error_at,
    lastError: r.last_error,
    consecutiveFailures: r.consecutive_failures,
    alertedAt: r.alerted_at,
  }));
}

/**
 * The alert pass's stamp: `at` when it emailed about `key`, `null` once the
 * recovered email has gone (spec section 2). Touches `alerted_at` only, not
 * `updated_at` (which is record_heartbeat's). A key with no row is a no-op.
 * Throws on a write error.
 */
export async function markAlerted(db: SupabaseClient, key: string, at: Date | null): Promise<void> {
  const { error } = await db.from("ops_heartbeats")
    .update({ alerted_at: at ? at.toISOString() : null })
    .eq("key", key);
  if (error) throw new Error(`markAlerted(${key}) failed: ${error.message}`);
}
