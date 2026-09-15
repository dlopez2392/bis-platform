import { createHash, randomInt } from "node:crypto";

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
