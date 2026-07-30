import { describe, it, expect, beforeAll } from "vitest";
import {
  HONEYPOT_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, DUPLICATE_WINDOW_MS,
  MAX_TOKEN_AGE_MS,
  signRenderToken, verifyRenderToken, hashIp, hashAnswers, parseAttribution,
  isValidEmail, isValidPhone,
} from "./guards";

const FORM_A = "form_a11111111";
const FORM_B = "form_b22222222";

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
    const token = signRenderToken(1_000_000, FORM_A);
    const result = verifyRenderToken(token, 1_005_000, FORM_A);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.elapsedMs).toBe(5000);
  });

  it("a tampered timestamp fails the signature instead of buying time", () => {
    // The whole point: a bot that rewrites the issued-at to look like it filled
    // the form slowly must not get through.
    const token = signRenderToken(Date.now(), FORM_A);
    const [, nonce, sig] = token.split(".");
    const forged = `1.${nonce}.${sig}`;

    const result = verifyRenderToken(forged, Date.now(), FORM_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("a malformed token is rejected without throwing", () => {
    for (const bad of ["", "nope", "a.b", "a.b.c.d"]) {
      expect(verifyRenderToken(bad, Date.now(), FORM_A).ok).toBe(false);
    }
  });

  it("a token older than MAX_TOKEN_AGE_MS is rejected as expired", () => {
    const issuedAt = 1_000_000;
    const token = signRenderToken(issuedAt, FORM_A);

    const justInside = verifyRenderToken(token, issuedAt + MAX_TOKEN_AGE_MS, FORM_A);
    expect(justInside.ok).toBe(true);

    const justOutside = verifyRenderToken(token, issuedAt + MAX_TOKEN_AGE_MS + 1, FORM_A);
    expect(justOutside.ok).toBe(false);
    if (!justOutside.ok) expect(justOutside.reason).toBe("expired");
  });

  it("a token minted for one form fails verification against a different form", () => {
    const token = signRenderToken(1_000_000, FORM_A);
    const result = verifyRenderToken(token, 1_005_000, FORM_B);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
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

  it("hashAnswers ignores the label, which the operator can rename at any time", () => {
    // The test above uses the same labels on both sides, so it would pass even
    // if label were part of the digest. Duplicate detection has to survive an
    // operator renaming a field between two identical submissions.
    expect(hashAnswers([{ key: "email", label: "Email", value: "lead@example.com" }]))
      .toBe(hashAnswers([{ key: "email", label: "Your email", value: "lead@example.com" }]));
  });

  it("hashAnswers does not collide a single field's value with a field boundary", () => {
    // Unescaped "key=value&key=value" joins let a value containing "&"/"="
    // imitate a second field. One free-text message with a pasted query
    // string must not hash the same as two genuinely different fields.
    const oneFieldWithDelimiters = [
      { key: "message", label: "Message", value: "a=b&x=y" },
    ];
    const twoSeparateFields = [
      { key: "message", label: "Message", value: "a=b" },
      { key: "x", label: "X", value: "y" },
    ];
    expect(hashAnswers(oneFieldWithDelimiters)).not.toBe(hashAnswers(twoSeparateFields));
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
    // Otherwise well-formed addresses (has "@", has a dotted TLD) that carry
    // one of the excluded characters — these must be rejected because of the
    // character, not merely because they lack an "@". A payload with no "@"
    // at all (e.g. `a"),phone.eq."x`) would pass this assertion even with a
    // naive `.+@.+\..+` regex that has none of the intended exclusions.
    expect(isValidEmail('ma"ria@example.com')).toBe(false);
    expect(isValidEmail("ma<ria>@example.com")).toBe(false);
    expect(isValidEmail(`a"),phone.eq."x@example.com`)).toBe(false);
    expect(isValidEmail("a,b@example.com")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("trailing@dot.")).toBe(false);
  });

  it("phone validation accepts real-world formats and rejects junk", () => {
    expect(isValidPhone("+1 (956) 555-0101")).toBe(true);
    expect(isValidPhone("956.555.0101")).toBe(true);
    // Common RGV formatting: parenthesized area code with no leading "+"/digit.
    expect(isValidPhone("(956) 555-0101")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("call me")).toBe(false);
  });

  it("verifyRenderToken rejects non-string input without throwing", () => {
    const badInputs: unknown[] = [undefined, null, 12345, {}, ["a", "b", "c"]];
    for (const bad of badInputs) {
      expect(() => verifyRenderToken(bad as unknown as string, Date.now(), FORM_A)).not.toThrow();
      expect(verifyRenderToken(bad as unknown as string, Date.now(), FORM_A)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("isValidEmail rejects non-string input without throwing", () => {
    const badInputs: unknown[] = [undefined, null, 12345, {}, ["a@example.com"]];
    for (const bad of badInputs) {
      expect(() => isValidEmail(bad as unknown as string)).not.toThrow();
      expect(isValidEmail(bad as unknown as string)).toBe(false);
    }
  });

  it("isValidPhone rejects non-string input without throwing", () => {
    const badInputs: unknown[] = [undefined, null, 9565550101, {}, ["9565550101"]];
    for (const bad of badInputs) {
      expect(() => isValidPhone(bad as unknown as string)).not.toThrow();
      expect(isValidPhone(bad as unknown as string)).toBe(false);
    }
  });

  it("hashAnswers coerces a non-string value to empty rather than throwing", () => {
    const withBadValue = [{ key: "message", label: "Message", value: 12345 as unknown as string }];
    const withEmptyValue = [{ key: "message", label: "Message", value: "" }];
    expect(() => hashAnswers(withBadValue)).not.toThrow();
    expect(hashAnswers(withBadValue)).toBe(hashAnswers(withEmptyValue));
  });
});
