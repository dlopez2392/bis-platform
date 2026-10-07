import { describe, it, expect } from "vitest";
import {
  signSipHandoff, verifySipHandoff, sipHandoffEnforced,
  SIP_HANDOFF_MAX_AGE_MS, SIP_HANDOFF_MIN_SECRET_LENGTH,
} from "./sip-handoff-signature";

const SECRET = "s".repeat(SIP_HANDOFF_MIN_SECRET_LENGTH);
const ENV = { VOICE_HANDOFF_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const TOKEN = "a".repeat(32);
const NOW = 1_790_000_000_000;
const CALLED = "+19565550100";
const CALLER = "+19565550111";

describe("the SIP handoff signature", () => {
  it("round-trips the called and calling numbers, + restored, and needs no escaping on a SIP URI", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    expect(v).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(encodeURIComponent(v)).toBe(v);
    expect(verifySipHandoff(v, TOKEN, NOW + 1_000, ENV)).toEqual({ ok: true, calledE164: CALLED, callerE164: CALLER });
  });

  it("a withheld or malformed caller signs as empty and verifies as null", () => {
    for (const odd of [null, "", "anonymous", "19565550111"]) {
      const v = signSipHandoff(TOKEN, CALLED, odd, NOW, ENV)!;
      expect(verifySipHandoff(v, TOKEN, NOW, ENV)).toEqual({ ok: true, calledE164: CALLED, callerE164: null });
    }
  });

  it("a changed called number is a bad signature (mutation: leave the called number out of the MAC)", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    const forged = v.replace(".19565550100.", ".19565550199.");
    expect(forged).not.toBe(v);
    expect(verifySipHandoff(forged, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("a changed or emptied caller is a bad signature (mutation: leave the caller out of the MAC)", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    const swapped = v.replace(".19565550111.", ".19565550222.");
    const emptied = v.replace(".19565550111.", "..");
    expect(swapped).not.toBe(v);
    expect(emptied).not.toBe(v);
    expect(verifySipHandoff(swapped, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
    expect(verifySipHandoff(emptied, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("is bound to this call's handoff token (mutation: drop the token from the MAC)", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    expect(verifySipHandoff(v, "b".repeat(32), NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
    expect(verifySipHandoff(v, null, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("a changed issue time is a bad signature, so the window cannot be extended by editing it", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    const later = v.replace(String(NOW), String(NOW + 60_000));
    expect(later).not.toBe(v);
    expect(verifySipHandoff(later, TOKEN, NOW + 60_000, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("a different secret refuses it (mutation: derive the key from a constant)", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    const other = { VOICE_HANDOFF_SECRET: "t".repeat(SIP_HANDOFF_MIN_SECRET_LENGTH) } as unknown as NodeJS.ProcessEnv;
    expect(verifySipHandoff(v, TOKEN, NOW, other)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("is valid up to the window's edge, and expired one millisecond past it, in both directions", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    expect(verifySipHandoff(v, TOKEN, NOW + SIP_HANDOFF_MAX_AGE_MS, ENV).ok).toBe(true);
    expect(verifySipHandoff(v, TOKEN, NOW - SIP_HANDOFF_MAX_AGE_MS, ENV).ok).toBe(true);
    expect(verifySipHandoff(v, TOKEN, NOW + SIP_HANDOFF_MAX_AGE_MS + 1, ENV)).toEqual({ ok: false, reason: "expired" });
    expect(verifySipHandoff(v, TOKEN, NOW - SIP_HANDOFF_MAX_AGE_MS - 1, ENV)).toEqual({ ok: false, reason: "expired" });
  });

  it("the window is short: two minutes", () => {
    expect(SIP_HANDOFF_MAX_AGE_MS).toBe(2 * 60_000);
  });

  it("a missing header is absent", () => {
    expect(verifySipHandoff(null, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "absent" });
    expect(verifySipHandoff(undefined, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "absent" });
    expect(verifySipHandoff("", TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "absent" });
  });

  it("no secret is reported as no-key even when the header is absent — with no secret the TeXML route sends none, and the misconfiguration must still name itself", () => {
    expect(verifySipHandoff(null, TOKEN, NOW, {} as NodeJS.ProcessEnv)).toEqual({ ok: false, reason: "no-key" });
  });

  it("no secret, or one shorter than the minimum, means no signature and no verification", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    const none = {} as NodeJS.ProcessEnv;
    const blank = { VOICE_HANDOFF_SECRET: "   " } as unknown as NodeJS.ProcessEnv;
    const short = { VOICE_HANDOFF_SECRET: "s".repeat(SIP_HANDOFF_MIN_SECRET_LENGTH - 1) } as unknown as NodeJS.ProcessEnv;
    for (const env of [none, blank, short]) {
      expect(signSipHandoff(TOKEN, CALLED, CALLER, NOW, env)).toBeNull();
      expect(verifySipHandoff(v, TOKEN, NOW, env)).toEqual({ ok: false, reason: "no-key" });
    }
  });

  it("refuses to sign what it could not verify", () => {
    expect(signSipHandoff("", CALLED, CALLER, NOW, ENV)).toBeNull();
    expect(signSipHandoff(TOKEN, "19565550100", CALLER, NOW, ENV)).toBeNull();
    expect(signSipHandoff(TOKEN, "", CALLER, NOW, ENV)).toBeNull();
  });

  it("refuses garbage without throwing", () => {
    const v = signSipHandoff(TOKEN, CALLED, CALLER, NOW, ENV)!;
    const [issued, called, caller, mac] = v.split(".");
    for (const bad of [
      "x", "1.2.3", "1.2.3.4.5",
      [issued, called, caller].join("."),
      ["abc", called, caller, mac].join("."),
      [issued, "12", caller, mac].join("."),
      [issued, called, "x1", mac].join("."),
    ]) {
      expect(verifySipHandoff(bad, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "malformed" });
    }
    // A MAC of the wrong length is a bad signature, never a throw from timingSafeEqual.
    expect(verifySipHandoff([issued, called, caller, "short"].join("."), TOKEN, NOW, ENV))
      .toEqual({ ok: false, reason: "bad-signature" });
  });
});

describe("sipHandoffEnforced", () => {
  it("is on only for an explicit 1 or true", () => {
    for (const on of ["1", "true", "TRUE", " true "]) {
      expect(sipHandoffEnforced({ VOICE_HANDOFF_ENFORCE: on } as unknown as NodeJS.ProcessEnv)).toBe(true);
    }
    for (const off of [undefined, "", "0", "false", "yes", "on"]) {
      expect(sipHandoffEnforced({ VOICE_HANDOFF_ENFORCE: off } as unknown as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it("does not depend on the secret: enforcing with no secret stays enforcing (fail closed)", () => {
    expect(sipHandoffEnforced({ VOICE_HANDOFF_ENFORCE: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
