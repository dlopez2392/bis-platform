import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { GoogleConnectionRef, GoogleSealResult } from "@bis/db";
import { readSecret } from "@/lib/fixture-secrets";

/**
 * The Google Calendar refresh token at rest (S-22 slice 1; plan
 * docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D5). Modelled on lib/consent/token.ts:
 * AES-256-GCM under a key HKDF-derived from GOOGLE_CALENDAR_TOKEN_KEY, which lives in the environment and
 * never in the database, with ONE _PREVIOUS slot for a rotation.
 *
 *   g1.<base64url(iv | AES-256-GCM(token) | tag)>
 *
 * BOUND TO ITS ROW. The GCM additional data names the account, the connection id and its version, so a
 * ciphertext copied onto another account's row, onto another row, or kept from an earlier connect, fails
 * authentication instead of opening. The version is bumped on every connect (upsertGoogleConnection), which
 * re-seals.
 *
 * KEY VERSION. google_calendar_connections.key_version stores the sealing key's id, a number HKDF-derived
 * from the key itself (1..32767), so it names the KEY, not a slot: after a rotation, rows whose key_version
 * is still the old key's id are exactly the ones a reconnect has not re-sealed yet, and the old key may be
 * dropped from _PREVIOUS once none are left.
 *
 * KEYS. Each is at least 32 bytes of base64url (`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`, or
 * Node's `randomBytes(32).toString("base64url")`). A shorter or non-base64url value is refused in EVERY
 * environment (plan D5: nothing should seal under a weak key), and in
 * production a value published in this repo (`fixture_only`, lib/fixture-secrets.ts) is refused too. A
 * refused key reads as no key, so the feature stays dormant; one log line names the variable, never the value.
 *
 * Never log a token or a sealed value.
 */
export type GoogleTokenKey = { readonly id: number; readonly enc: Buffer };

const FORMAT = "g1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_KEY_BYTES = 32;
/** A cap on what is sealed, in UTF-8 BYTES (what is encrypted), so the sealed value always fits the column's 4096. */
const MAX_TOKEN_BYTES = 2048;
/** Longer than any value this module seals (MAX_TOKEN_BYTES sealed is ~2,780 characters); a bound on work. */
const MAX_SEALED_CHARS = 4096;
const SALT = "bis-google-calendar-token";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The key a value of GOOGLE_CALENDAR_TOKEN_KEY names, or null when it is not 32+ bytes of base64url. */
export function googleTokenKey(value: string): GoogleTokenKey | null {
  const v = value.trim();
  if (!BASE64URL.test(v)) return null;
  const material = Buffer.from(v, "base64url");
  if (material.length < MIN_KEY_BYTES) return null;
  const enc = Buffer.from(hkdfSync("sha256", material, SALT, "enc-v1", 32));
  const id = (Buffer.from(hkdfSync("sha256", material, SALT, "key-id-v1", 2)).readUInt16BE(0) % 32767) + 1;
  return { id, enc };
}

function readKey(name: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>): GoogleTokenKey | null {
  // readSecret: in production a value published in this repo reads as unset, with its own log line.
  const value = readSecret(name, env);
  if (!value || !value.trim()) return null;
  const key = googleTokenKey(value);
  if (!key) {
    console.error(`${name} is not at least ${MIN_KEY_BYTES} bytes of base64url; it is refused and Google Calendar stays off until it is replaced`);
  }
  return key;
}

export function googleTokenKeys(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { current: GoogleTokenKey | null; previous: GoogleTokenKey | null } {
  const current = readKey("GOOGLE_CALENDAR_TOKEN_KEY", env);
  const previous = readKey("GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS", env);
  // Two different keys with one id (1 in 32767): opening still works (each same-id key is tried), but key_version
  // can no longer tell which rows a rotation has re-sealed. Ask for a new key; never print either value.
  if (current && previous && current.id === previous.id && !current.enc.equals(previous.enc)) {
    console.error("GOOGLE_CALENDAR_TOKEN_KEY and GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS are different keys with the same key id, so key_version cannot tell them apart; generate a new key for GOOGLE_CALENDAR_TOKEN_KEY");
  }
  return { current, previous };
}

function validRow(row: GoogleConnectionRef): boolean {
  return UUID.test(row.accountId) && UUID.test(row.id) && Number.isSafeInteger(row.version) && row.version >= 1;
}

/** The additional data: the row the ciphertext belongs to. */
function aad(row: GoogleConnectionRef): Buffer {
  return Buffer.from(`${SALT}|${FORMAT}|${row.accountId.toLowerCase()}|${row.id.toLowerCase()}|${row.version}`, "utf8");
}

/** Seal a refresh token for exactly this row. Throws on an empty or oversized token or a malformed row. */
export function sealGoogleToken(token: string, row: GoogleConnectionRef, key: GoogleTokenKey): GoogleSealResult {
  if (!token) throw new Error("sealGoogleToken: no token");
  if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) throw new Error(`sealGoogleToken: token longer than ${MAX_TOKEN_BYTES} bytes`);
  if (!validRow(row)) throw new Error("sealGoogleToken: the row is not a connection row");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.enc, iv);
  cipher.setAAD(aad(row));
  const raw = Buffer.concat([iv, cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { sealed: `${FORMAT}.${raw.toString("base64url")}`, keyVersion: key.id };
}

/**
 * The refresh token, or null: not a sealed value, sealed for another row, under a key not given, or tampered
 * with. Only a key whose id is `keyVersion` is tried. Never throws.
 */
export function openGoogleToken(
  sealed: unknown, keyVersion: number, row: GoogleConnectionRef,
  keys: readonly (GoogleTokenKey | null | undefined)[],
): string | null {
  if (typeof sealed !== "string" || sealed.length > MAX_SEALED_CHARS || !validRow(row)) return null;
  const dot = sealed.indexOf(".");
  if (dot < 0 || sealed.slice(0, dot) !== FORMAT) return null;
  const body = sealed.slice(dot + 1);
  if (!BASE64URL.test(body)) return null;
  const raw = Buffer.from(body, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  for (const key of keys) {
    if (!key || key.id !== keyVersion) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key.enc, raw.subarray(0, IV_BYTES));
      decipher.setAAD(aad(row));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    } catch {
      // Authentication failed under this key; a same-id second key (a 1-in-32767 collision) is tried next.
    }
  }
  return null;
}
