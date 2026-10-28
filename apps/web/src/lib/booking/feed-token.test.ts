import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { feedToken, feedTokenHash, feedTokenFromFile, feedUrl, webcalUrl, feedSecretConfigured } from "./feed-token";

const ID = "cccccccc-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllEnvs());

describe("feed-token", () => {
  it("derives a 43-character base64url token from the row id under the secret, stable and id-specific (mutation: drop the id from the HMAC input → FAILS)", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "s".repeat(32));
    const a = feedToken(ID);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(feedToken(ID)).toBe(a);
    expect(feedToken(ID.toUpperCase())).toBe(a);
    expect(feedToken("cccccccc-0000-4000-8000-000000000002")).not.toBe(a);
  });
  it("a different secret gives a different token (mutation: ignore the secret → FAILS)", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "s".repeat(32)); const a = feedToken(ID);
    vi.stubEnv("CALENDAR_FEED_SECRET", "t".repeat(32)); expect(feedToken(ID)).not.toBe(a);
  });
  it("refuses a missing or short secret, and says so without the value (mutation: fall back to a constant → FAILS)", () => {
    vi.stubEnv("CALENDAR_FEED_SECRET", "short");
    expect(feedSecretConfigured()).toBe(false);
    expect(() => feedToken(ID)).toThrow("CALENDAR_FEED_SECRET is required (at least 32 characters)");
  });
  it("hashes to sha256 hex, and the hash of a token one character off differs", () => {
    const t = "A".repeat(43);
    expect(feedTokenHash(t)).toBe(createHash("sha256").update(t).digest("hex"));
    expect(feedTokenHash("B" + t.slice(1))).not.toBe(feedTokenHash(t));
  });
  it.each([["A".repeat(43) + ".ics", "A".repeat(43)], ["A".repeat(43), null], ["A".repeat(42) + ".ics", null], ["A".repeat(43) + ".ICS", null], ["../" + "A".repeat(40) + ".ics", null]])(
    "feedTokenFromFile(%s) → %s (mutation: drop the suffix check → FAILS)", (file, want) => { expect(feedTokenFromFile(file)).toBe(want); });
  it("builds the https and webcal links", () => {
    const u = feedUrl("https://app.bis-rgv.com/", "T".repeat(43));
    expect(u).toBe(`https://app.bis-rgv.com/cal/${"T".repeat(43)}.ics`);
    expect(webcalUrl(u)).toBe(`webcal://app.bis-rgv.com/cal/${"T".repeat(43)}.ics`);
  });
});
