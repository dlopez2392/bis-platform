// Telnyx v2 webhook signatures: Ed25519 over `${timestamp}|${rawBody}`,
// headers telnyx-signature-ed25519 + telnyx-timestamp, public key from the
// Telnyx portal as base64 raw 32 bytes. Never throws — a malformed header
// or key is simply not a valid signature.
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyTelnyxSignature(input: {
  rawBody: string; timestamp: string | null; signatureB64: string | null; publicKeyB64: string;
}): boolean {
  if (!input.timestamp || !input.signatureB64) return false;
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
