import { describe, it, expect } from "vitest";
import { sealConsentToken, openConsentToken, consentTokenSecrets, isUuid, type ConsentTokenPayload } from "./token";

/**
 * The unsubscribe token (spec §4.3 "The token", plan Task 3, (decision Q3)). §8's
 * list: sign and verify, a tampered payload, a wrong secret, the previous
 * secret. Plus: nobody can read the address out of it, and it is URL-safe.
 */
const SECRET = "test-secret-0123456789abcdef-0123456789";
const OTHER = "another-secret-0123456789abcdef-012345";
const P: ConsentTokenPayload = {
  v: 1, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email", t: "ana.lopez@example.com",
  i: Date.parse("2026-10-01T15:00:00Z"), n: "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", k: "automation.reminder",
};

describe("sealConsentToken / openConsentToken", () => {
  it("round-trips the payload (mutation: open with the wrong key derivation info → null, FAILS)", () => {
    expect(openConsentToken(sealConsentToken(P, SECRET), [SECRET])).toEqual(P);
  });

  it("is URL-safe ASCII in three dot-separated parts, starting with its version (mutation: base64 instead of base64url → '+' or '/' appears for some token, FAILS over 200 seals)", () => {
    for (let i = 0; i < 200; i++) {
      const t = sealConsentToken({ ...P, i: P.i + i }, SECRET);
      expect(t).toMatch(/^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });

  it("does not carry the address, the account or the kind in readable form, even base64-decoded (plan G2, (decision Q3); mutation: store the JSON unencrypted → the decoded body contains the address, FAILS)", () => {
    const t = sealConsentToken(P, SECRET);
    const decoded = Buffer.from(t.split(".")[1]!, "base64url").toString("latin1");
    for (const secret of [P.t, "ana.lopez", P.a, "automation.reminder"]) {
      expect(t).not.toContain(secret);
      expect(decoded).not.toContain(secret);
    }
  });

  it("two seals of the same payload differ (a fresh IV each time), and both open (mutation: a fixed IV → identical tokens, FAILS)", () => {
    const one = sealConsentToken(P, SECRET);
    const two = sealConsentToken(P, SECRET);
    expect(one).not.toBe(two);
    expect(openConsentToken(two, [SECRET])).toEqual(P);
  });

  it("a wrong secret opens nothing (mutation: derive both keys from a constant instead of the secret → the other secret's token opens, FAILS)", () => {
    expect(openConsentToken(sealConsentToken(P, SECRET), [OTHER])).toBeNull();
  });

  it("the PREVIOUS secret still opens a token sealed before a rotation (spec §4.3; mutation: try only the first secret → null, FAILS)", () => {
    const old = sealConsentToken(P, OTHER);
    expect(openConsentToken(old, [SECRET, OTHER])).toEqual(P);
    expect(openConsentToken(old, [SECRET, null])).toBeNull();
  });

  it("a tampered body, a tampered MAC, a swapped body, a wrong version or a wrong shape opens nothing (mutation: compare the MAC with === on strings → still refuses; mutation: return the payload before checking the version → '2.' opens, FAILS)", () => {
    const t = sealConsentToken(P, SECRET);
    const [, body, mac] = t.split(".") as [string, string, string];
    const flip = (s: string) => (s[5] === "A" ? `${s.slice(0, 5)}B${s.slice(6)}` : `${s.slice(0, 5)}A${s.slice(6)}`);
    const other = sealConsentToken({ ...P, t: "bo@example.com" }, SECRET).split(".")[1]!;
    for (const bad of [
      `1.${flip(body)}.${mac}`, `1.${body}.${flip(mac)}`, `1.${other}.${mac}`, `2.${body}.${mac}`,
      `1.${body}`, `${t}.x`, "", "1..", "not a token",
    ]) expect(openConsentToken(bad, [SECRET])).toBeNull();
    expect(openConsentToken(undefined, [SECRET])).toBeNull();
    expect(openConsentToken(12345, [SECRET])).toBeNull();
    expect(openConsentToken(`1.${"A".repeat(5000)}.${mac}`, [SECRET])).toBeNull();
  });

  it("refuses a payload whose shape is wrong even under a valid MAC: another channel, an address the ledger would not key, a non-uuid account, a non-finite time (mutation: drop the shape check → the SMS payload opens, FAILS)", () => {
    const bad = [
      { ...P, c: "sms" }, { ...P, t: "Ana@Example.com" }, { ...P, t: "no-at-sign" },
      { ...P, a: "acct_1" }, { ...P, i: Number.NaN }, { ...P, n: "contact_1" }, { ...P, v: 2 },
    ];
    for (const p of bad) expect(openConsentToken(sealConsentToken(p as ConsentTokenPayload, SECRET), [SECRET])).toBeNull();
  });

  it("n and k are optional: a payload without them opens with n null and no k", () => {
    const bare: ConsentTokenPayload = { v: 1, a: P.a, c: "email", t: P.t, i: P.i, n: null };
    expect(openConsentToken(sealConsentToken(bare, SECRET), [SECRET])).toEqual(bare);
  });

  it("sealing with no secret throws: a caller must never mint a token nobody can check (mutation: fall back to '' → a token opens with the empty secret, FAILS)", () => {
    expect(() => sealConsentToken(P, "")).toThrow(/no secret/);
    expect(openConsentToken(sealConsentToken(P, SECRET), ["", null, undefined])).toBeNull();
  });
});

describe("isUuid", () => {
  it("is the opener's own rule (mutation: accept any string → 'ct_1' passes, FAILS)", () => {
    expect(isUuid(P.a)).toBe(true);
    expect(isUuid("ct_1")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("consentTokenSecrets", () => {
  it("reads the two variables, trimmed, blank as null — and NOTHING else, not the service-role key (spec §4.3: no fallback; mutation: fall back to SUPABASE_SERVICE_ROLE_KEY → current is set, FAILS)", () => {
    expect(consentTokenSecrets({ CONSENT_TOKEN_SECRET: "  s1  ", CONSENT_TOKEN_SECRET_PREVIOUS: "s0" } as unknown as NodeJS.ProcessEnv))
      .toEqual({ current: "s1", previous: "s0" });
    expect(consentTokenSecrets({ CONSENT_TOKEN_SECRET: "   ", SUPABASE_SERVICE_ROLE_KEY: "svc", FORM_TOKEN_SECRET: "f" } as unknown as NodeJS.ProcessEnv))
      .toEqual({ current: null, previous: null });
  });

  it("with CONSENT_TOKEN_SECRET ABSENT and the service-role key set, current is still null (review R2-I5: the blank case above cannot catch a `??` fallback, because `\"   \" ?? svc` is the blank string; mutation: `clean(env.CONSENT_TOKEN_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY)` → current 'svc', FAILS)", () => {
    expect(consentTokenSecrets({ SUPABASE_SERVICE_ROLE_KEY: "svc-0123456789abcdef-0123456789abcdef" } as unknown as NodeJS.ProcessEnv))
      .toEqual({ current: null, previous: null });
  });
});
