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
  it("accepts a valid signature", () => {
    const fresh = String(Math.floor(Date.now() / 1000));
    const { publicKeyB64, signatureB64 } = makeSigned(body, fresh);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: fresh, signatureB64, publicKeyB64 })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const fresh = String(Math.floor(Date.now() / 1000));
    const { publicKeyB64, signatureB64 } = makeSigned(body, fresh);
    expect(verifyTelnyxSignature({ rawBody: body + "&x=1", timestamp: fresh, signatureB64, publicKeyB64 })).toBe(false);
  });
  it("rejects a wrong timestamp, missing headers, and garbage keys without throwing", () => {
    const fresh = String(Math.floor(Date.now() / 1000));
    const { publicKeyB64, signatureB64 } = makeSigned(body, fresh);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: "999", signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: null, signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: fresh, signatureB64: null, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: fresh, signatureB64, publicKeyB64: "!!!" })).toBe(false);
  });

  describe("replay window (Finding A)", () => {
    it("accepts a fresh timestamp, signature generated over that same fresh timestamp", () => {
      const fresh = String(Math.floor(Date.now() / 1000));
      const { publicKeyB64, signatureB64 } = makeSigned(body, fresh);
      expect(verifyTelnyxSignature({ rawBody: body, timestamp: fresh, signatureB64, publicKeyB64 })).toBe(true);
    });
    it("rejects a stale timestamp (now - 400s) even with a VALID signature over it", () => {
      const stale = String(Math.floor(Date.now() / 1000) - 400);
      const { publicKeyB64, signatureB64 } = makeSigned(body, stale);
      expect(verifyTelnyxSignature({ rawBody: body, timestamp: stale, signatureB64, publicKeyB64 })).toBe(false);
    });
    it("rejects a future timestamp (now + 400s) even with a VALID signature over it", () => {
      const future = String(Math.floor(Date.now() / 1000) + 400);
      const { publicKeyB64, signatureB64 } = makeSigned(body, future);
      expect(verifyTelnyxSignature({ rawBody: body, timestamp: future, signatureB64, publicKeyB64 })).toBe(false);
    });
    it("rejects a non-numeric timestamp", () => {
      const fresh = String(Math.floor(Date.now() / 1000));
      const { publicKeyB64, signatureB64 } = makeSigned(body, fresh);
      expect(verifyTelnyxSignature({ rawBody: body, timestamp: "not-a-number", signatureB64, publicKeyB64 })).toBe(false);
    });
    it("toleranceSeconds override widens the window", () => {
      const stale = String(Math.floor(Date.now() / 1000) - 400);
      const { publicKeyB64, signatureB64 } = makeSigned(body, stale);
      expect(verifyTelnyxSignature({
        rawBody: body, timestamp: stale, signatureB64, publicKeyB64, toleranceSeconds: 500,
      })).toBe(true);
    });
  });
});
