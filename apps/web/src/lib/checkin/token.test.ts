import { createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openConsentToken, sealConsentToken } from "@/lib/consent/token";
import { openBriefToken, sealBriefToken } from "@/lib/brief/token";
import { openCheckinToken, readCheckinToken, sealCheckinToken } from "./token";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const OTHER_ACCT = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const BOOKING = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const OTHER_BOOKING = "7e3f8a2b-5d4c-4a6b-8c77-2b9c3e4f5a61";
const ISSUED = Date.parse("2027-06-15T12:00:00Z");
const PAYLOAD = { v: 1 as const, a: ACCT, b: BOOKING, l: "es" as const, i: ISSUED };
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

describe("the check-in token", () => {
  it("round-trips the account, the booking, the language and the issue time", () => {
    expect(openCheckinToken(sealCheckinToken(PAYLOAD, SECRET), [SECRET])).toEqual(PAYLOAD);
  });

  it("holds two ids, a language and a time, and no address", () => {
    const token = sealCheckinToken(PAYLOAD, SECRET);
    expect(JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"))).toEqual(PAYLOAD);
    expect(token).not.toContain("@");
  });

  it("carries the language it was sealed with, both ways", () => {
    expect(openCheckinToken(sealCheckinToken({ ...PAYLOAD, l: "en" }, SECRET), [SECRET])?.l).toBe("en");
    expect(openCheckinToken(sealCheckinToken({ ...PAYLOAD, l: "es" }, SECRET), [SECRET])?.l).toBe("es");
  });

  describe("tamper", () => {
    const token = sealCheckinToken(PAYLOAD, SECRET);
    const [v, body, sig] = token.split(".") as [string, string, string];
    const flip = (s: string) => `${s.slice(0, -2)}${s.at(-2) === "A" ? "B" : "A"}${s.at(-1)}`;

    it("a flipped payload byte is refused", () => {
      expect(openCheckinToken(`${v}.${flip(body)}.${sig}`, [SECRET])).toBeNull();
    });
    it("a flipped MAC byte is refused", () => {
      expect(openCheckinToken(`${v}.${body}.${flip(sig)}`, [SECRET])).toBeNull();
    });
    it("a swapped booking id under the old MAC is refused", () => {
      const swapped = b64(JSON.stringify({ ...PAYLOAD, b: OTHER_BOOKING }));
      expect(openCheckinToken(`${v}.${swapped}.${sig}`, [SECRET])).toBeNull();
    });
    it("a swapped account id under the old MAC is refused", () => {
      const swapped = b64(JSON.stringify({ ...PAYLOAD, a: OTHER_ACCT }));
      expect(openCheckinToken(`${v}.${swapped}.${sig}`, [SECRET])).toBeNull();
    });
    it("a swapped language under the old MAC is refused", () => {
      const swapped = b64(JSON.stringify({ ...PAYLOAD, l: "en" }));
      expect(openCheckinToken(`${v}.${swapped}.${sig}`, [SECRET])).toBeNull();
    });

    it("a wrong secret, no secret, a wrong version, a missing or extra part, a long or non-string value: refused", () => {
      expect(openCheckinToken(token, [OTHER])).toBeNull();
      expect(openCheckinToken(token, [null, undefined, ""])).toBeNull();
      expect(openCheckinToken(token, [])).toBeNull();
      expect(openCheckinToken(`2.${body}.${sig}`, [SECRET])).toBeNull();
      expect(openCheckinToken(`${v}.${body}`, [SECRET])).toBeNull();
      expect(openCheckinToken(`${token}.x`, [SECRET])).toBeNull();
      expect(openCheckinToken("x".repeat(5000), [SECRET])).toBeNull();
      expect(openCheckinToken(undefined, [SECRET])).toBeNull();
      expect(openCheckinToken(42, [SECRET])).toBeNull();
    });

    const macKey = () => Buffer.from(hkdfSync("sha256", SECRET, "bis-checkin-token", "mac-v1", 32));
    const signed = (raw: string) => `1.${raw}.${createHmac("sha256", macKey()).update(`1.${raw}`).digest("base64url")}`;
    const sealRaw = (o: unknown) => signed(b64(JSON.stringify(o)));

    it("a validly signed body of the wrong shape is refused (not a uuid, a language we do not speak, a bad time, a bad version)", () => {
      expect(openCheckinToken(sealRaw(PAYLOAD), [SECRET]), "control: the helper mints a real one").not.toBeNull();
      const refused = (o: unknown, why: string) => expect(openCheckinToken(sealRaw(o), [SECRET]), why).toBeNull();
      refused({ ...PAYLOAD, a: "x" }, "bad account");
      refused({ ...PAYLOAD, b: "x" }, "bad booking");
      refused({ ...PAYLOAD, l: "fr" }, "language");
      refused({ ...PAYLOAD, i: "x" }, "issued");
      refused({ ...PAYLOAD, v: 2 }, "version");
      refused({ v: 1, a: ACCT, l: "en", i: ISSUED }, "no booking");
      refused(null, "null");
      refused("str", "string");
    });

    it("a trailing '!', '=', a space, a newline, '+' or '/' on a validly signed token is refused", () => {
      expect(openCheckinToken(token, [SECRET]), "control").not.toBeNull();
      for (const tail of ["!", "=", " ", "\n", "+", "/"]) {
        expect(openCheckinToken(`${v}.${body}.${sig}${tail}`, [SECRET]), `sig + ${JSON.stringify(tail)}`).toBeNull();
        expect(openCheckinToken(signed(`${body}${tail}`), [SECRET]), `body + ${JSON.stringify(tail)}`).toBeNull();
      }
    });
  });

  it("the MAC is checked before the payload is parsed: a body that is not JSON but is signed is refused, not thrown on", () => {
    const key = Buffer.from(hkdfSync("sha256", SECRET, "bis-checkin-token", "mac-v1", 32));
    const raw = b64("{not json");
    const signed = `1.${raw}.${createHmac("sha256", key).update(`1.${raw}`).digest("base64url")}`;
    expect(openCheckinToken(signed, [SECRET])).toBeNull();
  });

  it("an earlier secret still opens a token sealed before a rotation (the consent token's one slot)", () => {
    const token = sealCheckinToken(PAYLOAD, OTHER);
    expect(openCheckinToken(token, [SECRET, OTHER])?.b).toBe(BOOKING);
    expect(openCheckinToken(token, [SECRET])).toBeNull();
  });

  it("the sealer refuses to mint what the opener would refuse (not a uuid, an unknown language)", () => {
    expect(() => sealCheckinToken({ ...PAYLOAD, b: "nope" }, SECRET)).toThrow();
    expect(() => sealCheckinToken({ ...PAYLOAD, a: "nope" }, SECRET)).toThrow();
    expect(() => sealCheckinToken({ ...PAYLOAD, l: "fr" as "en" }, SECRET)).toThrow();
    expect(() => sealCheckinToken(PAYLOAD, "")).toThrow();
  });

  describe("its own domain: no other token opens it and it opens no other", () => {
    it("a consent token is not a check-in token, and the reverse", () => {
      const consent = sealConsentToken({ v: 1, a: ACCT, c: "email", t: "ana@example.com", i: ISSUED, n: null }, SECRET);
      expect(openCheckinToken(consent, [SECRET])).toBeNull();
      expect(openConsentToken(sealCheckinToken(PAYLOAD, SECRET), [SECRET])).toBeNull();
    });

    it("a brief token is not a check-in token, and the reverse", () => {
      const brief = sealBriefToken({ v: 1, u: BOOKING, a: ACCT, i: ISSUED }, SECRET);
      expect(openCheckinToken(brief, [SECRET])).toBeNull();
      expect(openBriefToken(sealCheckinToken(PAYLOAD, SECRET), [SECRET])).toBeNull();
    });

    it("a check-in-shaped token MACed with the CONSENT key is refused (a shared HKDF label would accept it)", () => {
      const consentMac = Buffer.from(hkdfSync("sha256", SECRET, "bis-consent-token", "mac-v1", 32));
      const raw = b64(JSON.stringify(PAYLOAD));
      const forged = `1.${raw}.${createHmac("sha256", consentMac).update(`1.${raw}`).digest("base64url")}`;
      expect(openCheckinToken(forged, [SECRET])).toBeNull();
    });

    it("a check-in-shaped token MACed with the BRIEF key is refused", () => {
      const briefMac = Buffer.from(hkdfSync("sha256", SECRET, "bis-brief-token", "mac-v1", 32));
      const raw = b64(JSON.stringify(PAYLOAD));
      const forged = `1.${raw}.${createHmac("sha256", briefMac).update(`1.${raw}`).digest("base64url")}`;
      expect(openCheckinToken(forged, [SECRET])).toBeNull();
    });
  });
});

describe("readCheckinToken", () => {
  const env = (extra: Record<string, string>) => ({ NODE_ENV: "test", ...extra }) as NodeJS.ProcessEnv;

  it("is not_configured when CONSENT_TOKEN_SECRET is unset, whatever the token (the page answers before any query)", () => {
    expect(readCheckinToken(sealCheckinToken(PAYLOAD, SECRET), env({}))).toEqual({ ok: false, why: "not_configured" });
    expect(readCheckinToken("anything", env({}))).toEqual({ ok: false, why: "not_configured" });
  });

  it("is bad_token for one that does not open, and the payload for one that does", () => {
    const e = env({ CONSENT_TOKEN_SECRET: SECRET });
    expect(readCheckinToken("junk", e)).toEqual({ ok: false, why: "bad_token" });
    expect(readCheckinToken(sealCheckinToken(PAYLOAD, SECRET), e)).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("opens a token sealed under CONSENT_TOKEN_SECRET_PREVIOUS", () => {
    const token = sealCheckinToken(PAYLOAD, OTHER);
    expect(readCheckinToken(token, env({ CONSENT_TOKEN_SECRET: SECRET, CONSENT_TOKEN_SECRET_PREVIOUS: OTHER })).ok).toBe(true);
  });
});
