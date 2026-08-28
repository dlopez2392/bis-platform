import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyTelnyxSignature } from "./telnyx-signature";

function makeSigned(body: string, timestamp: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const sig = cryptoSign(null, Buffer.from(`${timestamp}|${body}`, "utf8"), privateKey);
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return {
    publicKeyB64: spki.subarray(spki.length - 32).toString("base64"),
    signatureB64: sig.toString("base64"),
  };
}

describe("verifyTelnyxSignature", () => {
  const body = "To=%2B19565061545&From=%2B19562921696";
  const ts = "1756300000";
  it("accepts a valid signature", () => {
    const { publicKeyB64, signatureB64 } = makeSigned(body, ts);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signatureB64, publicKeyB64 })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const { publicKeyB64, signatureB64 } = makeSigned(body, ts);
    expect(verifyTelnyxSignature({ rawBody: body + "&x=1", timestamp: ts, signatureB64, publicKeyB64 })).toBe(false);
  });
  it("rejects a wrong timestamp, missing headers, and garbage keys without throwing", () => {
    const { publicKeyB64, signatureB64 } = makeSigned(body, ts);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: "999", signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: null, signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signatureB64: null, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: ts, signatureB64, publicKeyB64: "!!!" })).toBe(false);
  });
});
