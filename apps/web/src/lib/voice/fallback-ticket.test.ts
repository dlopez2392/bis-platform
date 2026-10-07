import { describe, it, expect } from "vitest";
import { signFallbackTicket, verifyFallbackTicket, FALLBACK_TICKET_MAX_AGE_MS } from "./fallback-ticket";

const ENV = { SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture" } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = "0b2cbb04-b46c-4fed-a377-d377a1a201eb";
const TOKEN = "a".repeat(32);
const NOW = 1_790_000_000_000;

describe("the model-down fallback ticket", () => {
  it("round-trips the account and the dialled number, + restored", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV)!;
    expect(t).not.toContain("+");
    expect(verifyFallbackTicket(t, TOKEN, NOW + 5_000, ENV)).toEqual({ ok: true, accountId: ACCOUNT, calledE164: "+19565550100", callerE164: null });
  });

  it("carries the caller, signed, for the forwarded-call cap (0059); a withheld or malformed caller is empty, not a refusal", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV, "+19565550111")!;
    expect(verifyFallbackTicket(t, TOKEN, NOW, ENV)).toEqual({ ok: true, accountId: ACCOUNT, calledE164: "+19565550100", callerE164: "+19565550111" });
    for (const odd of [null, "", "anonymous", "19565550111"]) {
      const w = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV, odd)!;
      expect(verifyFallbackTicket(w, TOKEN, NOW, ENV)).toMatchObject({ ok: true, callerE164: null });
    }
  });

  it("the caller is under the signature: swapping it is a bad signature (mutation: leave the caller out of the MAC → FAILS)", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV, "+19565550111")!;
    expect(verifyFallbackTicket(t.replace(".19565550111.", ".19565550222."), TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
    expect(verifyFallbackTicket(t.replace(".19565550111.", ".."), TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("a four-part ticket from before 0059 is malformed, never half-read", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV)!;
    const [issued, account, called, , mac] = t.split(".");
    expect(verifyFallbackTicket([issued, account, called, mac].join("."), TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "malformed" });
  });

  it("is bound to THIS call's handoff token: another call's token refuses it (mutation: drop the token from the MAC → FAILS)", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV)!;
    expect(verifyFallbackTicket(t, "b".repeat(32), NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("naming another account is a bad signature, not a lookup (mutation: stop signing the account → FAILS)", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV)!;
    const forged = t.replace(ACCOUNT, "11111111-2222-4333-8444-555555555555");
    expect(verifyFallbackTicket(forged, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("expires after ten minutes, in both directions", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV)!;
    expect(verifyFallbackTicket(t, TOKEN, NOW + FALLBACK_TICKET_MAX_AGE_MS, ENV).ok).toBe(true);
    expect(verifyFallbackTicket(t, TOKEN, NOW + FALLBACK_TICKET_MAX_AGE_MS + 1, ENV)).toEqual({ ok: false, reason: "expired" });
    expect(verifyFallbackTicket(t, TOKEN, NOW - FALLBACK_TICKET_MAX_AGE_MS - 1, ENV)).toEqual({ ok: false, reason: "expired" });
  });

  it("a different service key refuses it, and no key means no ticket at all", () => {
    const t = signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, ENV)!;
    const other = { SUPABASE_SERVICE_ROLE_KEY: "rotated" } as unknown as NodeJS.ProcessEnv;
    expect(verifyFallbackTicket(t, TOKEN, NOW, other)).toEqual({ ok: false, reason: "bad-signature" });
    expect(signFallbackTicket(TOKEN, ACCOUNT, "+19565550100", NOW, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(verifyFallbackTicket(t, TOKEN, NOW, {} as NodeJS.ProcessEnv)).toEqual({ ok: false, reason: "no-key" });
  });

  it("refuses to sign what it could not verify, and refuses garbage without throwing", () => {
    expect(signFallbackTicket(TOKEN, "not-a-uuid", "+19565550100", NOW, ENV)).toBeNull();
    expect(signFallbackTicket(TOKEN, ACCOUNT, "19565550100", NOW, ENV)).toBeNull();
    expect(signFallbackTicket("", ACCOUNT, "+19565550100", NOW, ENV)).toBeNull();
    for (const bad of ["", "x", "1.2.3", "1.2.3.4", "1.2.3.4.5.6", `${NOW}.${ACCOUNT}.19565550100..short`, `${NOW}.${ACCOUNT}.19565550100.abc.short`]) {
      expect(verifyFallbackTicket(bad, TOKEN, NOW, ENV).ok).toBe(false);
    }
    expect(verifyFallbackTicket(null, TOKEN, NOW, ENV)).toEqual({ ok: false, reason: "absent" });
  });
});
