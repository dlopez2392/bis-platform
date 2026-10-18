import { describe, it, expect } from "vitest";
import { newShareToken, shareUrl } from "./share-token";
import { isTokenShape, tokenHash } from "@/lib/document-requests/token";

describe("share-link tokens (spec 4.1): 32 random bytes, base64url, only the sha256 stored", () => {
  it("a new token has the 43-character base64url shape, and two calls differ (mutation: a constant -> FAILS)", () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(isTokenShape(a)).toBe(true);
    expect(isTokenShape(b)).toBe(true);
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
  });

  it("its stored hash is 64 lowercase hex", () => {
    expect(tokenHash(newShareToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the link is <origin>/s/<token>, with an origin's trailing slashes dropped (mutation: keep the slash -> FAILS)", () => {
    const tok = "A".repeat(43);
    expect(shareUrl("https://app.example.com/", tok)).toBe(`https://app.example.com/s/${tok}`);
    expect(shareUrl("https://app.example.com//", tok)).toBe(`https://app.example.com/s/${tok}`);
    expect(shareUrl("https://app.example.com", tok)).toBe(`https://app.example.com/s/${tok}`);
  });
});
