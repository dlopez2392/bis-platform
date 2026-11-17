import { createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { openConsentToken, sealConsentToken } from "@/lib/consent/token";
import { briefOffLinks, openBriefToken, readBriefToken, sealBriefToken } from "./token";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);
const SUB = "4b1d6f0e-3c1a-4e2b-9a55-0f7a1c2d3e4f";
const OTHER_SUB = "9c2d7e1f-4d2b-4f3c-8b66-1a8b2d3e4f50";
const ISSUED = Date.parse("2027-06-15T12:00:00Z");
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

describe("the brief token", () => {
  it("round-trips the subscription id and the issue time", () => {
    const token = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, SECRET);
    expect(openBriefToken(token, [SECRET])).toEqual({ v: 1, s: SUB, i: ISSUED });
  });

  it("holds one uuid and no address: nothing a reader could use is in the url", () => {
    const token = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, SECRET);
    const body = Buffer.from(token.split(".")[1]!, "base64url").toString("utf8");
    expect(JSON.parse(body)).toEqual({ v: 1, s: SUB, i: ISSUED });
    expect(token).not.toContain("@");
  });

  it("never expires: a token from years ago still opens", () => {
    const old = sealBriefToken({ v: 1, s: SUB, i: Date.parse("2020-01-01T00:00:00Z") }, SECRET);
    expect(openBriefToken(old, [SECRET])?.s).toBe(SUB);
  });

  describe("tamper", () => {
    const token = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, SECRET);
    const [v, body, sig] = token.split(".") as [string, string, string];
    const flip = (s: string) => `${s.slice(0, -2)}${s.at(-2) === "A" ? "B" : "A"}${s.at(-1)}`;

    it("a changed body, a changed signature, a body swapped under the old signature: all refused", () => {
      expect(openBriefToken(`${v}.${flip(body)}.${sig}`, [SECRET]), "body").toBeNull();
      expect(openBriefToken(`${v}.${body}.${flip(sig)}`, [SECRET]), "sig").toBeNull();
      const swapped = b64(JSON.stringify({ v: 1, s: OTHER_SUB, i: ISSUED }));
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

    it("a validly signed body of the wrong shape is refused (not a uuid, not a number)", () => {
      const sealRaw = (o: unknown) => {
        const mac = Buffer.from(hkdfSync("sha256", SECRET, "bis-brief-token", "mac-v1", 32));
        const raw = b64(JSON.stringify(o));
        return `1.${raw}.${createHmac("sha256", mac).update(`1.${raw}`).digest("base64url")}`;
      };
      expect(openBriefToken(sealRaw({ v: 1, s: SUB, i: ISSUED }), [SECRET]), "control: the helper mints a real one").not.toBeNull();
      expect(openBriefToken(sealRaw({ v: 1, s: "not-a-uuid", i: ISSUED }), [SECRET])).toBeNull();
      expect(openBriefToken(sealRaw({ v: 1, s: SUB, i: "x" }), [SECRET])).toBeNull();
      expect(openBriefToken(sealRaw({ v: 2, s: SUB, i: ISSUED }), [SECRET])).toBeNull();
      expect(openBriefToken(sealRaw(null), [SECRET])).toBeNull();
      expect(openBriefToken(sealRaw("str"), [SECRET])).toBeNull();
    });
  });

  it("an earlier secret still opens a token sealed before a rotation (the consent token's one slot)", () => {
    const token = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, OTHER);
    expect(openBriefToken(token, [SECRET, OTHER])?.s).toBe(SUB);
    expect(openBriefToken(token, [SECRET])).toBeNull();
  });

  describe("its own domain: a consent token and a brief token never open each other", () => {
    it("a brief token is not a consent token", () => {
      const brief = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, SECRET);
      expect(openConsentToken(brief, [SECRET])).toBeNull();
    });

    it("a real consent token is not a brief token", () => {
      const consent = sealConsentToken({ v: 1, a: SUB, c: "email", t: "ana@example.com", i: ISSUED, n: null }, SECRET);
      expect(openBriefToken(consent, [SECRET])).toBeNull();
    });

    it("a brief-shaped token MACed with the CONSENT key is refused (a shared HKDF label would accept it)", () => {
      const consentMac = Buffer.from(hkdfSync("sha256", SECRET, "bis-consent-token", "mac-v1", 32));
      const raw = b64(JSON.stringify({ v: 1, s: SUB, i: ISSUED }));
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
    const token = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, SECRET);
    expect(readBriefToken(token, e)).toEqual({ ok: true, payload: { v: 1, s: SUB, i: ISSUED } });
  });
  it("opens a token sealed under CONSENT_TOKEN_SECRET_PREVIOUS", () => {
    const token = sealBriefToken({ v: 1, s: SUB, i: ISSUED }, OTHER);
    expect(readBriefToken(token, env({ CONSENT_TOKEN_SECRET: SECRET, CONSENT_TOKEN_SECRET_PREVIOUS: OTHER })).ok).toBe(true);
  });
});

describe("briefOffLinks", () => {
  const env = { NODE_ENV: "test", CONSENT_TOKEN_SECRET: SECRET } as NodeJS.ProcessEnv;
  it("builds the page link and the one-click link on the same token, under the origin it was given", () => {
    const links = briefOffLinks({ subscriptionId: SUB, now: new Date(ISSUED), origin: "https://app.bis-rgv.com/", env })!;
    const token = links.page.split("/brief/off/")[1]!;
    expect(links.page).toBe(`https://app.bis-rgv.com/brief/off/${token}`);
    expect(links.oneClick).toBe(`https://app.bis-rgv.com/api/brief/off/${token}`);
    expect(openBriefToken(token, [SECRET])).toEqual({ v: 1, s: SUB, i: ISSUED });
  });
  it("in production a secret under 32 characters makes no link (the email gate's own floor for the consent link)", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const prod = (secret: string) => ({ VERCEL_ENV: "production", CONSENT_TOKEN_SECRET: secret }) as unknown as NodeJS.ProcessEnv;
      const make = (secret: string) => briefOffLinks({ subscriptionId: SUB, now: new Date(ISSUED), origin: "https://app.bis-rgv.com", env: prod(secret) });
      expect(make("short")).toBeNull();
      expect(make(SECRET)).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("is null when there is no secret or no usable origin, never a link that cannot work", () => {
    expect(briefOffLinks({ subscriptionId: SUB, now: new Date(ISSUED), origin: "https://x.com", env: { NODE_ENV: "test" } as NodeJS.ProcessEnv })).toBeNull();
    expect(briefOffLinks({ subscriptionId: SUB, now: new Date(ISSUED), origin: null, env })).toBeNull();
    expect(briefOffLinks({ subscriptionId: SUB, now: new Date(ISSUED), origin: "not a url", env })).toBeNull();
    expect(briefOffLinks({ subscriptionId: "nope", now: new Date(ISSUED), origin: "https://x.com", env })).toBeNull();
  });
});
