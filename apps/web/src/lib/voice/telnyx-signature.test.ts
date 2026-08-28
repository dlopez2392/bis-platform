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
  it("rejects a frozen/out-of-window timestamp (via the freshness gate), missing headers, and garbage keys without throwing", () => {
    const fresh = String(Math.floor(Date.now() / 1000));
    const { publicKeyB64, signatureB64 } = makeSigned(body, fresh);
    // "999" (year-1970 epoch seconds) is rejected by the freshness gate
    // before crypto ever runs — this is NOT a timestamp-binding case; see
    // the "timestamp binding" describe below for that property.
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: "999", signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: null, signatureB64, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: fresh, signatureB64: null, publicKeyB64 })).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, timestamp: fresh, signatureB64, publicKeyB64: "!!!" })).toBe(false);
  });

  describe("timestamp binding", () => {
    it("rejects when the signature was computed over a different (but still fresh) timestamp than the one presented", () => {
      const now = Math.floor(Date.now() / 1000);
      const signedOver = String(now - 10);
      const { publicKeyB64, signatureB64 } = makeSigned(body, signedOver);
      // Sanity control: verified against the exact timestamp it was signed
      // over, this same signature is valid — proves the rejection below is
      // the timestamp-binding property, not a broken fixture.
      expect(verifyTelnyxSignature({ rawBody: body, timestamp: signedOver, signatureB64, publicKeyB64 })).toBe(true);
      // Both timestamps are inside the 300s freshness window, so this isn't
      // the freshness gate rejecting — the signature simply doesn't cover
      // the timestamp being presented.
      expect(verifyTelnyxSignature({ rawBody: body, timestamp: String(now), signatureB64, publicKeyB64 })).toBe(false);
    });
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
