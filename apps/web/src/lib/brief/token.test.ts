import { createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { openConsentToken, sealConsentToken } from "@/lib/consent/token";
import { briefOffLinks, openBriefToken, readBriefToken, sealBriefToken } from "./token";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);
const USER = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const OTHER_USER = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const ISSUED = Date.parse("2027-06-15T12:00:00Z");
const PAYLOAD = { v: 1 as const, u: USER, a: ACCT, i: ISSUED };
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

describe("the brief token", () => {
  it("round-trips the subscription id and the issue time", () => {
    const token = sealBriefToken(PAYLOAD, SECRET);
    expect(openBriefToken(token, [SECRET])).toEqual(PAYLOAD);
  });

  it("holds a person id and a business id and no address: nothing a reader could use is in the url", () => {
    const token = sealBriefToken(PAYLOAD, SECRET);
    const body = Buffer.from(token.split(".")[1]!, "base64url").toString("utf8");
    expect(JSON.parse(body)).toEqual(PAYLOAD);
    expect(token).not.toContain("@");
  });

  it("never expires: a token from years ago still opens", () => {
    const old = sealBriefToken({ v: 1, u: USER, a: ACCT, i: Date.parse("2020-01-01T00:00:00Z") }, SECRET);
    expect(openBriefToken(old, [SECRET])?.u).toBe(USER);
  });

  describe("tamper", () => {
    const token = sealBriefToken(PAYLOAD, SECRET);
    const [v, body, sig] = token.split(".") as [string, string, string];
    const flip = (s: string) => `${s.slice(0, -2)}${s.at(-2) === "A" ? "B" : "A"}${s.at(-1)}`;

    it("a changed body, a changed signature, a body swapped under the old signature: all refused", () => {
      expect(openBriefToken(`${v}.${flip(body)}.${sig}`, [SECRET]), "body").toBeNull();
      expect(openBriefToken(`${v}.${body}.${flip(sig)}`, [SECRET]), "sig").toBeNull();
      const swapped = b64(JSON.stringify({ v: 1, u: OTHER_USER, a: ACCT, i: ISSUED }));
      expect(openBriefToken(`${v}.${swapped}.${sig}`, [SECRET]), "swapped").toBeNull();
    });

    it("a wrong secret, an unset secret, a wrong version, a missing or extra part, a long or non-string value: refused", () => {
      expect(openBriefToken(token, [OTHER])).toBeNull();
      expect(openBriefToken(token, [null, undefined, ""])).toBeNull();
      expect(openBriefToken(token, [])).toBeNull();
      expect(openBriefToken(`2.${body}.${sig}`, [SECRET])).toBeNull();
      expect(openBriefToken(`${v}.${body}`, [SECRET])).toBeNull();
      expect(openBriefToken(`${token}.x`, [SECRET])).toBeNull();
      expect(openBriefToken(`${v}..${sig}`, [SECRET])).toBeNull();
      expect(openBriefToken("x".repeat(5000), [SECRET])).toBeNull();
      expect(openBriefToken(undefined, [SECRET])).toBeNull();
      expect(openBriefToken(42, [SECRET])).toBeNull();
    });

    const macKey = () => Buffer.from(hkdfSync("sha256", SECRET, "bis-brief-token", "mac-v1", 32));
    const signed = (raw: string) => `1.${raw}.${createHmac("sha256", macKey()).update(`1.${raw}`).digest("base64url")}`;
    const sealRaw = (o: unknown) => signed(b64(JSON.stringify(o)));

    it("a validly signed body of the wrong shape is refused (not a uuid, not a number, the old row-id shape)", () => {
      expect(openBriefToken(sealRaw(PAYLOAD), [SECRET]), "control: the helper mints a real one").not.toBeNull();
      const refused = (o: unknown, why: string) => expect(openBriefToken(sealRaw(o), [SECRET]), why).toBeNull();
      refused({ v: 1, u: "not-a-uuid", a: ACCT, i: ISSUED }, "bad user");
      refused({ ...PAYLOAD, i: "x" }, "i");
      refused({ v: 1, u: USER, i: ISSUED }, "no account");
      refused({ v: 1, u: USER, a: "x", i: ISSUED }, "bad account");
      refused({ v: 1, s: USER, i: ISSUED }, "the old row-id shape");
      refused({ ...PAYLOAD, v: 2 }, "version");
      refused(null, "null");
      refused("str", "string");
    });

    it("the encoding is strict: a trailing '!', '=', '==', a space, a newline, '+' or '/' on a validly signed token is refused", () => {
      expect(openBriefToken(token, [SECRET]), "control").not.toBeNull();
      for (const tail of ["!", "=", "==", " ", "\n", "+", "/"]) {
        expect(openBriefToken(`${v}.${body}.${sig}${tail}`, [SECRET]), `sig + ${JSON.stringify(tail)}`).toBeNull();
        // The MAC covers the body, so sign the padded body to prove the body's own alphabet check.
        expect(openBriefToken(signed(`${body}${tail}`), [SECRET]), `body + ${JSON.stringify(tail)}`).toBeNull();
      }
    });

    it("a properly signed body longer than the 2048-character bound is refused (only the bound can refuse it)", () => {
      expect(openBriefToken(sealRaw({ ...PAYLOAD, pad: "x" }), [SECRET]), "control: same shape, short").not.toBeNull();
      const long = sealRaw({ ...PAYLOAD, pad: "x".repeat(2100) });
      expect(long.length).toBeGreaterThan(2048);
      expect(openBriefToken(long, [SECRET])).toBeNull();
    });
  });

  it("an earlier secret still opens a token sealed before a rotation (the consent token's one slot)", () => {
    const token = sealBriefToken(PAYLOAD, OTHER);
    expect(openBriefToken(token, [SECRET, OTHER])?.u).toBe(USER);
    expect(openBriefToken(token, [SECRET])).toBeNull();
  });

  describe("its own domain: a consent token and a brief token never open each other", () => {
    it("a brief token is not a consent token", () => {
      const brief = sealBriefToken(PAYLOAD, SECRET);
      expect(openConsentToken(brief, [SECRET])).toBeNull();
    });

    it("a real consent token is not a brief token", () => {
      const consent = sealConsentToken({ v: 1, a: ACCT, c: "email", t: "ana@example.com", i: ISSUED, n: null }, SECRET);
      expect(openBriefToken(consent, [SECRET])).toBeNull();
    });

    it("a brief-shaped token MACed with the CONSENT key is refused (a shared HKDF label would accept it)", () => {
      const consentMac = Buffer.from(hkdfSync("sha256", SECRET, "bis-consent-token", "mac-v1", 32));
      const raw = b64(JSON.stringify(PAYLOAD));
      const forged = `1.${raw}.${createHmac("sha256", consentMac).update(`1.${raw}`).digest("base64url")}`;
      expect(openBriefToken(forged, [SECRET])).toBeNull();
    });
  });
});

describe("readBriefToken", () => {
  const env = (extra: Record<string, string>) => ({ NODE_ENV: "test", ...extra }) as NodeJS.ProcessEnv;
  it("is not_configured when CONSENT_TOKEN_SECRET is unset, whatever the token", () => {
    expect(readBriefToken("anything", env({}))).toEqual({ ok: false, why: "not_configured" });
  });
  it("is bad_token for a token that does not open, and the payload for one that does", () => {
    const e = env({ CONSENT_TOKEN_SECRET: SECRET });
    expect(readBriefToken("junk", e)).toEqual({ ok: false, why: "bad_token" });
    const token = sealBriefToken(PAYLOAD, SECRET);
    expect(readBriefToken(token, e)).toEqual({ ok: true, payload: PAYLOAD });
  });
  it("opens a token sealed under CONSENT_TOKEN_SECRET_PREVIOUS", () => {
    const token = sealBriefToken(PAYLOAD, OTHER);
    expect(readBriefToken(token, env({ CONSENT_TOKEN_SECRET: SECRET, CONSENT_TOKEN_SECRET_PREVIOUS: OTHER })).ok).toBe(true);
  });
});

describe("briefOffLinks", () => {
  const env = { NODE_ENV: "test", CONSENT_TOKEN_SECRET: SECRET } as NodeJS.ProcessEnv;
  it("builds the page link and the one-click link on the same token, under the origin it was given", () => {
    const links = briefOffLinks({ userId: USER, accountId: ACCT, now: new Date(ISSUED), origin: "https://app.bis-rgv.com/", env })!;
    const token = links.page.split("/brief/off/")[1]!;
    expect(links.page).toBe(`https://app.bis-rgv.com/brief/off/${token}`);
    expect(links.oneClick).toBe(`https://app.bis-rgv.com/api/brief/off/${token}`);
    expect(openBriefToken(token, [SECRET])).toEqual(PAYLOAD);
  });
  it("in production a secret under 32 characters makes no link (the email gate's own floor for the consent link)", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const prod = (secret: string) => ({ VERCEL_ENV: "production", CONSENT_TOKEN_SECRET: secret }) as unknown as NodeJS.ProcessEnv;
      const make = (secret: string) => briefOffLinks({ userId: USER, accountId: ACCT, now: new Date(ISSUED), origin: "https://app.bis-rgv.com", env: prod(secret) });
      expect(make("short")).toBeNull();
      expect(make(SECRET)).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("is null when there is no secret or no usable origin, never a link that cannot work", () => {
    expect(briefOffLinks({ userId: USER, accountId: ACCT, now: new Date(ISSUED), origin: "https://x.com", env: { NODE_ENV: "test" } as NodeJS.ProcessEnv })).toBeNull();
    expect(briefOffLinks({ userId: USER, accountId: ACCT, now: new Date(ISSUED), origin: null, env })).toBeNull();
    expect(briefOffLinks({ userId: USER, accountId: ACCT, now: new Date(ISSUED), origin: "not a url", env })).toBeNull();
    expect(briefOffLinks({ userId: "nope", accountId: ACCT, now: new Date(ISSUED), origin: "https://x.com", env })).toBeNull();
  });
});
