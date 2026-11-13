// apps/web/src/lib/owner-line/secrets.ts
// The owner line's two secrets (F-032 §3.1, §3.2; plan SC-6). No @bis/db import (the TeXML routes import this
// statically: SC-18).
//
// THE PIN: scrypt from node:crypto (memory-hard and built in; neither argon2 nor bcrypt is a dependency), N=2^17,
// r=8, p=1 (OWASP's floor), a 16-byte salt and a 32-byte key. Its password is HMAC-SHA256(PIN) under a key derived
// from OWNER_LINE_PIN_PEPPER in its own domain, so a database-only leak cannot be cracked offline. It is written as
// "scrypt:17:8:1:<salt b64url 22>:<key b64url 43>" (80 characters, 0115's CHECK).
// SQL never derives it. The answer lookup returns the first 36 characters (the parameters and the salt), this file
// derives the candidate, and owner_line_attempt_pin compares under a row lock.
// No pepper is a CONFIGURATION error, never a silent unpeppered hash: both functions throw. owner-pin turns that
// into today's path, with no attempt counted.
//
// THE CALL-IN CODE: sha256 hex, exactly like the alert-phone code (packages/db/src/alert-phone-verification.ts:68),
// because a 10-minute, 3-attempt code is defended by its limits.
import { createHash, createHmac, randomBytes, randomInt, scrypt } from "node:crypto";
import { readSecret } from "@/lib/fixture-secrets";

const N = 2 ** 17;
const R = 8;
const P = 1;
/** "scrypt:17:8:1:", built from the parameters it names, so the stored string can never claim a cost it was not
 *  derived at. */
export const PIN_PARAMS_PREFIX = `scrypt:${Math.log2(N)}:${R}:${P}:`;
const KEYLEN = 32;
/** 128 * N * r = 128 MiB; node refuses at its default maxmem, so 256 MiB. */
const MAXMEM = 256 * 1024 * 1024;
const PEPPER_MIN = 32;

export type PinRefusal = "not_six_digits" | "repeated" | "run";

export function checkPin(pin: string): { ok: true } | { ok: false; reason: PinRefusal } {
  if (!/^[0-9]{6}$/.test(pin)) return { ok: false, reason: "not_six_digits" };
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return { ok: false, reason: "repeated" };
  const up = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  const down = d.every((x, i) => i === 0 || x === d[i - 1]! - 1);
  if (up || down) return { ok: false, reason: "run" };
  return { ok: true };
}

export function pinPepperConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (readSecret("OWNER_LINE_PIN_PEPPER", env)?.trim().length ?? 0) >= PEPPER_MIN;
}

function peppered(pin: string, env: NodeJS.ProcessEnv): string {
  // Two messages, neither carrying the value or its length. In production a
  // value published in this repo reads as unset (lib/fixture-secrets.ts).
  const pepper = readSecret("OWNER_LINE_PIN_PEPPER", env)?.trim();
  if (!pepper) throw new Error("owner line: OWNER_LINE_PIN_PEPPER is not set");
  if (pepper.length < PEPPER_MIN) {
    throw new Error(`owner line: OWNER_LINE_PIN_PEPPER is too short (it needs at least ${PEPPER_MIN} characters)`);
  }
  const key = createHash("sha256").update(`bis-owner-line-pin:${pepper}`).digest();
  return createHmac("sha256", key).update(pin, "utf8").digest("base64url");
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPin(pin: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const password = peppered(pin, env);
  const salt = randomBytes(16).toString("base64url");
  return `${PIN_PARAMS_PREFIX}${salt}:${(await derive(password, salt)).toString("base64url")}`;
}

/** The string owner_line_attempt_pin compares. Null for a malformed prefix or an entry that is not 6 digits. */
export async function candidateFor(pin: string, pinParams: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const password = peppered(pin, env);   // throws first: a missing pepper is never mistaken for a wrong PIN
  if (!/^[0-9]{6}$/.test(pin)) return null;
  if (pinParams.length !== 36 || !pinParams.startsWith(PIN_PARAMS_PREFIX)) return null;
  const salt = pinParams.slice(PIN_PARAMS_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{22}$/.test(salt)) return null;
  return `${pinParams}:${(await derive(password, salt)).toString("base64url")}`;
}

export function newVerifyCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashVerifyCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
