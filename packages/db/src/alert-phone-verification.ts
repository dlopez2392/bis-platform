import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setAlertPhone } from "./accounts";

/**
 * The TypeScript side of `0036_alert_phone_verifications.sql`.
 *
 * Every constant here is a CHECK constraint in that migration, and the
 * migration's comments carry the reasoning. They live in one file so the two
 * sides cannot drift the way `0033`'s generated column drifted from its twin:
 * there, SQL's `trim(both ' ' from …)` and JS's `.trim()` disagreed about a
 * tab and a CSV import silently produced a different key on each side.
 *
 * The drift risk here is narrower on purpose — SQL never computes the hash,
 * only its SHAPE (`^[0-9a-f]{64}$`) — but it is the same class of bug, so the
 * parity test pins Node's digest against a value POSTGRES computed.
 */

/** Six digits: 10^6 codes. What every SMS code a person has ever typed looks
 *  like, and what Supabase's own auth OTP uses (`config.toml`, `otp_length`).
 *  Longer is not safer here — the attempt cap, not the length, is what makes
 *  guessing hopeless. */
export const ALERT_CODE_DIGITS = 6;

/** Five wrong guesses and the row is spent. Not unlimited, because a
 *  six-digit code with unlimited attempts is not a gate — a script walks the
 *  whole space. Not three, because an operator reading a code off a handset
 *  mistypes, and locking them out of their own number on the third slip is
 *  the friction that makes people give up and ask the agency to "just set
 *  it", which is the hole this exists to close. Five in 10^6 is one in
 *  200,000 per live code. */
export const ALERT_CODE_MAX_ATTEMPTS = 5;

/** Ten minutes. The operator has the handset in their hand while they do
 *  this; an hour of validity buys nothing and widens the window in which a
 *  code sitting in a stranger's message list is still worth something. */
export const ALERT_CODE_TTL_MINUTES = 10;

/**
 * A code the caller could not have predicted.
 *
 * `randomInt` from node:crypto, never `Math.random()`: a predictable code is
 * not a code. Zero-padded, because `String(randomInt(0, 1_000_000))` is five
 * digits about one draw in ten and a five-digit code quietly throws away 90%
 * of the space the attempt cap is sized against.
 */
export function generateAlertCode(): string {
  const ceiling = 10 ** ALERT_CODE_DIGITS;
  return String(randomInt(0, ceiling)).padStart(ALERT_CODE_DIGITS, "0");
}

/**
 * What goes in `alert_phone_verifications.code_hash`. Never the code itself.
 *
 * Lowercase hex SHA-256, which is exactly `encode(digest(code,'sha256'),
 * 'hex')` — pinned against Postgres's own answer in the parity test, so the
 * column's `^[0-9a-f]{64}$` and this function cannot drift.
 *
 * ⚠️ This is NOT secrecy and the migration says so at length. An unsalted
 * digest of a six-digit code is a million preimages, which is milliseconds:
 * anyone who can READ the table can recover the code. What it buys is that
 * the code is not LEGIBLE — nobody reads it out of a dashboard row and types
 * it in on the requester's behalf, which is the shortcut that would turn
 * proof of possession into a rubber stamp, because here the requester and
 * the person with dashboard access are the same agency operator.
 */
export function hashAlertCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/**
 * How many verifications an account may OPEN for one (account, phone) pair
 * in an hour, before the send path refuses another. 0036's own Decision 4
 * says a rate limit belongs here, not in the schema: no UNIQUE index can
 * express "no more than N in an hour," and the migration deliberately allows
 * unlimited live rows so a mistyped-then-corrected attempt is never blocked.
 * Five mirrors `ALERT_CODE_MAX_ATTEMPTS` for the same practical shape — an
 * operator who fat-fingers a resend or two must not be locked out, while a
 * script trying to run up an account's texting bill is bounded to five real
 * sends an hour, not unlimited.
 */
export const ALERT_CODE_MAX_SENDS_PER_HOUR = 5;

/**
 * How many rows this (account, phone) pair has opened in the last hour —
 * what `ALERT_CODE_MAX_SENDS_PER_HOUR` is measured against. Counts every
 * row regardless of outcome (verified, wrong, or simply expired unused):
 * the limit is about how many real texts a claim can cost, and a code that
 * was answered correctly still cost exactly one.
 */
export async function countRecentAlertPhoneVerifications(
  db: SupabaseClient, accountId: string, phone: string, sinceMs = 60 * 60_000,
): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { count, error } = await db.from("alert_phone_verifications")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("phone", phone)
    .gte("created_at", since);
  if (error) throw new Error(`countRecentAlertPhoneVerifications failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Opens an attempt: draws a code, hashes it, and inserts the row. Never
 * touches `accounts.alert_phone` — 0036 Decision 3 is explicit that the
 * pending number has nowhere to live until a code comes back, and this
 * function is the "nowhere" side of that: it writes only this table.
 * Returns the code exactly once, in memory; the row keeps only its hash, so
 * the caller (the send path) must send it now and hold nothing else.
 */
export async function startAlertPhoneVerification(
  db: SupabaseClient, accountId: string, phone: string,
): Promise<{ id: string; code: string }> {
  const code = generateAlertCode();
  const { data, error } = await db.from("alert_phone_verifications")
    .insert({ account_id: accountId, phone, code_hash: hashAlertCode(code) })
    .select("id").single();
  if (error || !data) throw new Error(`startAlertPhoneVerification failed: ${error?.message}`);
  return { id: data.id, code };
}

/** What `verifyAlertPhoneCode` reports. No fourth state for "never asked" —
 *  see that function's own comment for why "expired" covers it too. */
export type AlertPhoneVerificationOutcome = "verified" | "wrong_code" | "expired";

/**
 * Consumes the newest LIVE attempt for (accountId, phone) and, only on a
 * match, writes `accounts.alert_phone` — CONSUME, THEN WRITE, exactly the
 * order 0036 Decision 3 pins and forbids reversing. If the write below
 * throws after the consume above lands, the code is burnt and the number is
 * NOT set — the safe failure direction the migration names. Reversing this
 * order would risk the opposite: a live number with no proof behind it.
 * ⚠️ DO NOT swap this order.
 *
 * "Live" mirrors the migration's own CHECK constraints instead of a second
 * notion of it: `consumed_at is null`, `expires_at > now()`, `attempts <
 * ALERT_CODE_MAX_ATTEMPTS`. That last clause is what turns "five wrong
 * guesses" into "no live row left to guess against" — this function never
 * writes a sixth `attempts` value, so the database's own CHECK stays the
 * backstop for a bug in this function, not the everyday gate.
 *
 * Returns "expired" for every non-match that is NOT "a live row whose hash
 * disagrees": no row at all, an already-consumed row, an actually-expired
 * row, and an attempts-exhausted row all read identically to the caller.
 * That is deliberate, not an oversight — the operator learns "wrong code"
 * only when there was something live to be wrong against, and this return
 * value alone never tells them whether the number was ever claimed at all.
 *
 * Looks only at the NEWEST live row for this exact (accountId, phone) pair.
 * 0036 Decision 4 allows several live rows on the same account at once (an
 * agency correcting a mistyped number keeps its first attempt alive), but
 * the operator holds exactly one code — the one just texted for THIS
 * number — so an older still-live attempt for the SAME number is left
 * alone rather than folded into this guess.
 */
export async function verifyAlertPhoneCode(
  db: SupabaseClient, accountId: string, phone: string, code: string, actorId: string,
): Promise<AlertPhoneVerificationOutcome> {
  const { data: rows, error } = await db.from("alert_phone_verifications")
    .select("id, code_hash, attempts")
    .eq("account_id", accountId).eq("phone", phone)
    .is("consumed_at", null)
    .lt("attempts", ALERT_CODE_MAX_ATTEMPTS)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`verifyAlertPhoneCode lookup failed: ${error.message}`);
  const row = rows?.[0];
  if (!row) return "expired";

  if (hashAlertCode(code) !== row.code_hash) {
    // Optimistic concurrency on `attempts`, not a blind increment: two
    // verify calls racing on the SAME row would otherwise both read
    // `attempts` at N and both write N+1, losing a guess the attempt cap
    // was meant to charge. The extra `.eq("attempts", row.attempts)` turns
    // the write into a compare-and-swap Postgres serializes on its own; the
    // loser touches zero rows, which is treated the same as "the row moved
    // under us" — safe, since the operator is still there to try again.
    const { data: updated, error: incError } = await db.from("alert_phone_verifications")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id).eq("attempts", row.attempts)
      .select("id");
    if (incError) throw new Error(`verifyAlertPhoneCode attempt-increment failed: ${incError.message}`);
    if (!updated?.length) return "expired";
    return "wrong_code";
  }

  const { data: consumed, error: consumeError } = await db.from("alert_phone_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id).is("consumed_at", null)
    .select("id");
  if (consumeError) throw new Error(`verifyAlertPhoneCode consume failed: ${consumeError.message}`);
  if (!consumed?.length) return "expired"; // raced with another verify; nothing left to prove

  await setAlertPhone(db, accountId, phone, actorId);
  return "verified";
}
