import { describe, it, expect, beforeAll } from "vitest";
import {
  HONEYPOT_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, DUPLICATE_WINDOW_MS,
  signRenderToken, verifyRenderToken, hashIp, hashAnswers, parseAttribution,
  isValidEmail, isValidPhone,
} from "./guards";

beforeAll(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key"; });

describe("form guards", () => {
  it("exposes the tuning constants the spec fixed", () => {
    expect(HONEYPOT_FIELD).toBe("bis_hp");
    expect(MIN_FILL_MS).toBe(2000);
    expect(RATE_LIMIT_MAX).toBe(5);
    expect(RATE_LIMIT_WINDOW_MS).toBe(600_000);
    expect(DUPLICATE_WINDOW_MS).toBe(60_000);
  });

  it("a signed render token verifies and reports elapsed time", () => {
    const token = signRenderToken(1_000_000);
    const result = verifyRenderToken(token, 1_005_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.elapsedMs).toBe(5000);
  });

  it("a tampered timestamp fails the signature instead of buying time", () => {
    // The whole point: a bot that rewrites the issued-at to look like it filled
    // the form slowly must not get through.
    const token = signRenderToken(Date.now());
    const [, nonce, sig] = token.split(".");
    const forged = `1.${nonce}.${sig}`;

    const result = verifyRenderToken(forged, Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("a malformed token is rejected without throwing", () => {
    for (const bad of ["", "nope", "a.b", "a.b.c.d"]) {
      expect(verifyRenderToken(bad, Date.now()).ok).toBe(false);
    }
  });

  it("hashIp is stable, opaque, and never the raw address", () => {
    const h = hashIp("203.0.113.9");
    expect(h).toBe(hashIp("203.0.113.9"));
    expect(h).not.toContain("203.0.113.9");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.10")).not.toBe(h);
  });

  it("hashAnswers ignores whitespace, case and key order", () => {
    const a = [{ key: "email", label: "E", value: "Lead@Example.com " },
               { key: "name", label: "N", value: "Maria" }];
    const b = [{ key: "name", label: "N", value: " maria" },
               { key: "email", label: "E", value: "lead@example.com" }];
    expect(hashAnswers(a)).toBe(hashAnswers(b));
    expect(hashAnswers([{ key: "email", label: "E", value: "other@example.com" }]))
      .not.toBe(hashAnswers(a));
  });

  it("parseAttribution keeps the tracking keys and the host page, drops the rest", () => {
    const params = new URLSearchParams({
      utm_source: "google", utm_medium: "cpc", gclid: "abc123",
      page: "https://bis-rgv.com/es/contacto?utm_source=google",
      ref: "https://www.google.com/", locale: "es", nonsense: "drop me",
    });
    const attribution = parseAttribution(params);
    expect(attribution).toEqual({
      utm_source: "google", utm_medium: "cpc", gclid: "abc123",
      page: "https://bis-rgv.com/es/contacto?utm_source=google",
      ref: "https://www.google.com/",
    });
  });

  it("email validation rejects the characters that break a PostgREST filter", () => {
    expect(isValidEmail("maria@example.com")).toBe(true);
    expect(isValidEmail("maria+quote@sub.example.co")).toBe(true);
    expect(isValidEmail(`a"),phone.eq."x`)).toBe(false);
    expect(isValidEmail("a,b@example.com")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("trailing@dot.")).toBe(false);
  });

  it("phone validation accepts real-world formats and rejects junk", () => {
    expect(isValidPhone("+1 (956) 555-0101")).toBe(true);
    expect(isValidPhone("956.555.0101")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("call me")).toBe(false);
  });
});
