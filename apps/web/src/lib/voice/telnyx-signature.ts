// Telnyx v2 webhook signatures: Ed25519 over `${timestamp}|${rawBody}`,
// headers telnyx-signature-ed25519 + telnyx-timestamp, public key from the
// Telnyx portal as base64 raw 32 bytes. Never throws — a malformed header
// or key is simply not a valid signature.
//
// Replay window: a valid signature alone doesn't stop a captured POST being
// replayed forever (which would re-disclose the SIP project URI on every
// replay) — the timestamp must also be within `toleranceSeconds` of now.
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEFAULT_TOLERANCE_SECONDS = 300;

export function verifyTelnyxSignature(input: {
  rawBody: string; timestamp: string | null; signatureB64: string | null; publicKeyB64: string;
  toleranceSeconds?: number;
}): boolean {
  if (!input.timestamp || !input.signatureB64) return false;
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;
  try {
    const raw = Buffer.from(input.publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(`${input.timestamp}|${input.rawBody}`, "utf8"),
      key,
      Buffer.from(input.signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}
