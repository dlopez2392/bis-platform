import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { googleTokenKey, googleTokenKeys, sealGoogleToken, openGoogleToken } from "./token-seal";

/**
 * S-22 slice 1, PR 1 (plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D5): the Google refresh
 * token is sealed with AES-256-GCM under GOOGLE_CALENDAR_TOKEN_KEY, bound to its row (account, id, version), with
 * one _PREVIOUS slot for rotation. Fixed keys, so their key versions are fixed too.
 */
const KEY_A = Buffer.alloc(32, 1).toString("base64url");
const KEY_B = Buffer.alloc(32, 2).toString("base64url");
const A = googleTokenKey(KEY_A)!;
const B = googleTokenKey(KEY_B)!;
/** A Google refresh token's shape: "1//0g" and base64-ish, slashes included. */
const TOKEN = `1//0g${randomBytes(70).toString("base64")}`;
const ROW = { accountId: randomUUID(), id: randomUUID(), version: 3 };
/** google_calendar_connections_refresh_token_sealed_check, the migration's twin of the sealed shape. */
const SQL_SHAPE = /^g[0-9]+[.][A-Za-z0-9_-]+$/;
/** A fixture value by the repo's convention (lib/fixture-secrets.ts), long enough to pass the length rule. */
const FIXTURE_KEY = "fixture_only_google_calendar_token_key_0000000";

afterEach(() => vi.restoreAllMocks());

describe("sealGoogleToken / openGoogleToken", () => {
  it("round trip: what is sealed for a row opens for that row, in the shape the table's check accepts", () => {
    const s = sealGoogleToken(TOKEN, ROW, A);
    expect(s.keyVersion).toBe(A.id);
    expect(s.sealed).toMatch(SQL_SHAPE);
    expect(s.sealed.length).toBeLessThanOrEqual(4096);
    expect(s.sealed).not.toContain(TOKEN.slice(5, 25));
    expect(openGoogleToken(s.sealed, s.keyVersion, ROW, [A])).toBe(TOKEN);
  });

  it("the cap is 2048 BYTES, not characters: the largest token it seals fits the table's 4096, multi-byte or not (probe: cap on .length -> FAILS)", () => {
    for (const t of ["x".repeat(2048), "é".repeat(1024), "😀".repeat(512)]) {
      const s = sealGoogleToken(t, ROW, A);
      expect(s.sealed).toMatch(SQL_SHAPE);
      expect(s.sealed.length).toBeLessThanOrEqual(4096);
    }
    // 2049, 2050 and 2052 bytes in 2049, 1025 and 1026 UTF-16 characters.
    for (const t of ["x".repeat(2049), "é".repeat(1025), "😀".repeat(513)]) {
      expect(() => sealGoogleToken(t, ROW, A)).toThrow();
    }
  });

  it("two seals of one token differ (a fresh IV each time)", () => {
    expect(sealGoogleToken(TOKEN, ROW, A).sealed).not.toBe(sealGoogleToken(TOKEN, ROW, A).sealed);
  });

  it("a wrong key does not open it", () => {
    const s = sealGoogleToken(TOKEN, ROW, A);
    expect(openGoogleToken(s.sealed, s.keyVersion, ROW, [B])).toBeNull();
  });

  it("the previous key still opens it after a rotation, and key_version names the key that sealed it", () => {
    expect(A.id).not.toBe(B.id);
    const s = sealGoogleToken(TOKEN, ROW, A);
    const rotated = googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY: KEY_B, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: KEY_A });
    expect(openGoogleToken(s.sealed, s.keyVersion, ROW, [rotated.current, rotated.previous])).toBe(TOKEN);
    expect(sealGoogleToken(TOKEN, ROW, rotated.current!).keyVersion).toBe(B.id);
    expect(openGoogleToken(s.sealed, s.keyVersion, ROW, [rotated.current, null])).toBeNull();
  });

  it("only the key key_version names is tried: another key's id, or an id no key has, does not open it", () => {
    const s = sealGoogleToken(TOKEN, ROW, A);
    expect(openGoogleToken(s.sealed, B.id, ROW, [A, B])).toBeNull();
    expect(openGoogleToken(s.sealed, 0, ROW, [A, B])).toBeNull();
  });

  it("a tampered tag, ciphertext or IV does not open it", () => {
    const s = sealGoogleToken(TOKEN, ROW, A);
    const raw = Buffer.from(s.sealed.slice(3), "base64url");
    for (const at of [raw.length - 1, 20, 0]) {
      const bad = Buffer.from(raw);
      bad[at] = bad[at]! ^ 0x01;
      expect(openGoogleToken(`g1.${bad.toString("base64url")}`, s.keyVersion, ROW, [A])).toBeNull();
    }
  });

  it("a moved row does not open: another account, another id or another version (probe: drop the additional data -> FAILS)", () => {
    const s = sealGoogleToken(TOKEN, ROW, A);
    expect(openGoogleToken(s.sealed, s.keyVersion, { ...ROW, accountId: randomUUID() }, [A])).toBeNull();
    expect(openGoogleToken(s.sealed, s.keyVersion, { ...ROW, id: randomUUID() }, [A])).toBeNull();
    expect(openGoogleToken(s.sealed, s.keyVersion, { ...ROW, version: ROW.version + 1 }, [A])).toBeNull();
  });

  it("garbage never throws, it does not open", () => {
    for (const v of [undefined, null, 42, "", "g1.", "g2.AAAA", "g1.AAAA", `g1.${"A".repeat(5000)}`, TOKEN]) {
      expect(openGoogleToken(v, A.id, ROW, [A])).toBeNull();
    }
    expect(openGoogleToken(sealGoogleToken(TOKEN, ROW, A).sealed, A.id, ROW, [])).toBeNull();
  });

  it("sealing refuses an empty token and a row that is not a row (no uuid, a version under 1)", () => {
    expect(() => sealGoogleToken("", ROW, A)).toThrow();
    expect(() => sealGoogleToken(TOKEN, { ...ROW, accountId: "acct" }, A)).toThrow();
    expect(() => sealGoogleToken(TOKEN, { ...ROW, id: "" }, A)).toThrow();
    expect(() => sealGoogleToken(TOKEN, { ...ROW, version: 0 }, A)).toThrow();
  });
});

describe("googleTokenKeys (GOOGLE_CALENDAR_TOKEN_KEY, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS)", () => {
  it("unset reads as no key, and says nothing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(googleTokenKeys({})).toEqual({ current: null, previous: null });
    expect(err).not.toHaveBeenCalled();
  });

  it("a 32-byte base64url key is accepted in production, and both slots are read", () => {
    const k = googleTokenKeys({ VERCEL_ENV: "production", GOOGLE_CALENDAR_TOKEN_KEY: KEY_A, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: KEY_B });
    expect(k.current?.id).toBe(A.id);
    expect(k.previous?.id).toBe(B.id);
  });

  it("a short key (31 bytes) is refused in production, with a line naming the variable and never the value", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const short = randomBytes(31).toString("base64url");
    expect(googleTokenKeys({ VERCEL_ENV: "production", GOOGLE_CALENDAR_TOKEN_KEY: short }).current).toBeNull();
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("GOOGLE_CALENDAR_TOKEN_KEY");
    expect(logged).not.toContain(short);
  });

  it("a short key is refused outside production too: no environment seals under a weak key", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: randomBytes(16).toString("base64url") }).previous).toBeNull();
  });

  it("a key that is not base64url (standard base64 with + / =, or spaces inside) is refused", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const std = Buffer.alloc(32, 0xfb).toString("base64");
    expect(std).toMatch(/[+/=]/);
    expect(googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY: std }).current).toBeNull();
    expect(googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY: `${KEY_A.slice(0, 20)} ${KEY_A.slice(20)}` }).current).toBeNull();
  });

  it("a published fixture key is refused in production (readSecret), with a line naming the variable and never the value", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const k = googleTokenKeys({ VERCEL_ENV: "production", GOOGLE_CALENDAR_TOKEN_KEY: FIXTURE_KEY, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: FIXTURE_KEY });
    expect(k).toEqual({ current: null, previous: null });
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("GOOGLE_CALENDAR_TOKEN_KEY");
    expect(logged).not.toContain(FIXTURE_KEY);
  });

  it("the same fixture key is accepted outside production (CI and local runs may use one)", () => {
    expect(googleTokenKeys({ VERCEL_ENV: "preview", GOOGLE_CALENDAR_TOKEN_KEY: FIXTURE_KEY }).current).not.toBeNull();
  });

  it("two DIFFERENT keys whose ids clash: one line naming both variables (never a value) asks for a new key, and both still open", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Deterministic keys until two share an id (15 bits: a clash within a few hundred).
    const byId = new Map<number, string>();
    let pair: [string, string] | null = null;
    for (let i = 0; !pair; i++) {
      const v = createHash("sha256").update(`clash-${i}`).digest("base64url");
      const id = googleTokenKey(v)!.id;
      const prior = byId.get(id);
      if (prior) pair = [prior, v]; else byId.set(id, v);
    }
    const [cur, prev] = pair;
    const k = googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY: cur, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: prev });
    expect(k.current!.id).toBe(k.previous!.id);
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0]![0]);
    expect(line).toContain("GOOGLE_CALENDAR_TOKEN_KEY");
    expect(line).toContain("GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS");
    expect(line).toMatch(/new key/i);
    expect(line).not.toContain(cur);
    expect(line).not.toContain(prev);
    const old = sealGoogleToken(TOKEN, ROW, k.previous!);
    expect(openGoogleToken(old.sealed, old.keyVersion, ROW, [k.current, k.previous])).toBe(TOKEN);
    const now = sealGoogleToken(TOKEN, ROW, k.current!);
    expect(openGoogleToken(now.sealed, now.keyVersion, ROW, [k.current, k.previous])).toBe(TOKEN);
  });

  it("the SAME key in both slots is not a clash and says nothing", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY: KEY_A, GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS: KEY_A });
    expect(err).not.toHaveBeenCalled();
  });

  it("surrounding whitespace is trimmed, as a pasted value carries it", () => {
    expect(googleTokenKeys({ GOOGLE_CALENDAR_TOKEN_KEY: ` ${KEY_A}\n` }).current?.id).toBe(A.id);
  });
});
