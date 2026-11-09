// apps/web/src/lib/owner-line/secrets.test.ts
import { describe, it, expect } from "vitest";
import { checkPin, hashPin, candidateFor, newVerifyCode, hashVerifyCode, pinPepperConfigured, PIN_PARAMS_PREFIX } from "./secrets";

const SHAPE = /^scrypt:17:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/;
const ENV = { OWNER_LINE_PIN_PEPPER: "p".repeat(40) } as unknown as NodeJS.ProcessEnv;
const OTHER = { OWNER_LINE_PIN_PEPPER: "q".repeat(40) } as unknown as NodeJS.ProcessEnv;

describe("checkPin (spec §3.1: exactly 6 digits; 000000, 123456, a repeated digit, a run refused with a reason)", () => {
  it.each([
    ["000000", "repeated", "all zeros"],
    ["777777", "repeated", "one digit six times"],
    ["123456", "run", "the ascending run from 1"],
    ["654321", "run", "a descending run (mutation: drop the descending run -> FAILS)"],
    ["345678", "run", "an ascending run that does not start at 1"],
    ["12345", "not_six_digits", "five digits"],
    ["1234567", "not_six_digits", "seven digits"],
    ["12a456", "not_six_digits", "a letter among the digits"],
    [" 48291", "not_six_digits", "a leading space"],
  ])("%s is refused as %s: %s", (pin, reason) => {
    expect(checkPin(pin)).toEqual({ ok: false, reason });
  });
  it.each(["482913", "135790", "112358", "090807"])("%s is accepted", (pin) => {
    expect(checkPin(pin)).toEqual({ ok: true });
  });
});

describe("hashPin / candidateFor (SC-6: peppered scrypt; SQL compares the strings)", () => {
  it("is the exact shape 0115's pin_hash CHECK accepts: 80 characters", async () => {
    const h = await hashPin("482913", ENV);
    expect(h).toMatch(SHAPE);
    expect(h).toHaveLength(80);
    expect(h.startsWith(PIN_PARAMS_PREFIX)).toBe(true);
  });
  it("salts: one PIN hashes differently twice", async () => {
    expect(await hashPin("482913", ENV)).not.toBe(await hashPin("482913", ENV));
  });
  it("the candidate for the right PIN, derived from the stored salt prefix, IS the stored hash (mutation: N = 2**16 in candidateFor -> FAILS)", async () => {
    const h = await hashPin("482913", ENV);
    expect(await candidateFor("482913", h.slice(0, 36), ENV)).toBe(h);
    expect(await candidateFor("482914", h.slice(0, 36), ENV)).not.toBe(h);
  });
  it("a hash and its salt are useless without the pepper: another pepper never reproduces it (mutation: hash the bare PIN -> FAILS)", async () => {
    const h = await hashPin("482913", ENV);
    expect(await candidateFor("482913", h.slice(0, 36), OTHER)).not.toBe(h);
  });
  it("a known answer, computed outside this file with scryptSync(HMAC-SHA256(PIN) keyed by sha256(\"bis-owner-line-pin:\" + pepper), salt, 32, {N: 2**17, r: 8, p: 1}) (mutations: N = 2**16; N = 2**10 with r = 1; the handoff key domain; the raw pepper as the HMAC key -> each FAILS)", async () => {
    expect(PIN_PARAMS_PREFIX).toBe("scrypt:17:8:1:");
    expect(await candidateFor("482913", PIN_PARAMS_PREFIX + "AAAAAAAAAAAAAAAAAAAAAA", ENV))
      .toBe("scrypt:17:8:1:AAAAAAAAAAAAAAAAAAAAAA:ShB19WHKMzNMK8TkJhYrbry-KQiFxCfEK5dcl71dz4E");
  });
  it("no pepper, or a short one, refuses to hash or check at all, rather than silently hashing without it", async () => {
    expect(pinPepperConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(pinPepperConfigured({ OWNER_LINE_PIN_PEPPER: "short" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    await expect(hashPin("482913", {} as NodeJS.ProcessEnv)).rejects.toThrow(/OWNER_LINE_PIN_PEPPER/);
    await expect(candidateFor("482913", PIN_PARAMS_PREFIX + "A".repeat(22), {} as NodeJS.ProcessEnv)).rejects.toThrow(/OWNER_LINE_PIN_PEPPER/);
  });
  it("names an unset pepper and a short one as different problems, and never prints the value or its length", async () => {
    const SHORT = "shortpepper-xyz";   // 15 characters
    await expect(hashPin("482913", {} as NodeJS.ProcessEnv)).rejects.toThrow("owner line: OWNER_LINE_PIN_PEPPER is not set");
    await expect(hashPin("482913", { OWNER_LINE_PIN_PEPPER: "   " } as unknown as NodeJS.ProcessEnv))
      .rejects.toThrow("owner line: OWNER_LINE_PIN_PEPPER is not set");
    const err = await hashPin("482913", { OWNER_LINE_PIN_PEPPER: SHORT } as unknown as NodeJS.ProcessEnv).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("owner line: OWNER_LINE_PIN_PEPPER is too short (it needs at least 32 characters)");
    expect(err?.message).not.toContain(SHORT);
    expect(err?.message).not.toMatch(/\b15\b/);
  });
  it("a malformed prefix or a non-6-digit entry has no candidate (it can never match)", async () => {
    const h = await hashPin("482913", ENV);
    expect(await candidateFor("482913", "scrypt:15:8:1:" + h.slice(14, 36), ENV)).toBeNull();
    expect(await candidateFor("4829", h.slice(0, 36), ENV)).toBeNull();
  });
  it("one hash takes under 2 s here (A-8; logs the measured time for the report)", async () => {
    const t0 = Date.now();
    await hashPin("482913", ENV);
    const ms = Date.now() - t0;
    console.log(`owner-line scrypt N=2^17: ${ms} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe("the call-in code", () => {
  it("is 6 digits, zero-padded, and hashes to 64 lowercase hex (0115's verify_code_hash CHECK)", () => {
    for (let i = 0; i < 50; i++) expect(newVerifyCode()).toMatch(/^[0-9]{6}$/);
    expect(hashVerifyCode("123456")).toBe("8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
  });
});
