import { describe, it, expect } from "vitest";
import { lastCustomerReply, startChannel, textReadiness, emailReadiness, type LastReply, type Readiness } from "./start-channel";

const row = (direction: string, channel: string, author_kind: string) => ({ direction, channel, author_kind });

describe("lastCustomerReply: the newest row that is the customer reaching the business (spec §6, G11)", () => {
  it("their text or their email, newest first (mutation: scan oldest first → 'sms', FAILS)", () => {
    expect(lastCustomerReply([row("inbound", "sms", "customer"), row("inbound", "email", "customer")])).toBe("email");
    expect(lastCustomerReply([row("inbound", "email", "customer"), row("inbound", "sms", "customer")])).toBe("sms");
  });
  it("a teammate's forward is skipped, and so is everything the business sent (mutation: count any inbound email → 'email', FAILS)", () => {
    expect(lastCustomerReply([row("inbound", "sms", "customer"), row("inbound", "email", "person"), row("outbound", "email", "person")])).toBe("sms");
  });
  it("a web chat, a form or a call is 'other', the call's copy too although the receptionist wrote it (mutation: require author customer for voice → null, FAILS)", () => {
    expect(lastCustomerReply([row("inbound", "sms", "customer"), row("inbound", "webchat", "customer")])).toBe("other");
    expect(lastCustomerReply([row("inbound", "form", "customer")])).toBe("other");
    expect(lastCustomerReply([row("inbound", "voice", "ai")])).toBe("other");
    expect(lastCustomerReply([row("outbound", "webchat", "ai")])).toBeNull();
  });
  it("nothing from them at all is null", () => {
    expect(lastCustomerReply([])).toBeNull();
    expect(lastCustomerReply([row("outbound", "sms", "person")])).toBeNull();
  });
});

describe("readiness, from the reads the record page already makes (spec §6)", () => {
  const OPEN = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
  it("Text: ready exactly when the composer's text form would open; stopped when they stopped texts; otherwise unavailable (mutation: ready without a usable number → FAILS)", () => {
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: OPEN, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("ready");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: OPEN, smsBlockedLine: "They stopped texts.", recipient: { kind: "stopped", since: "2026-10-01T00:00:00Z" } })).toBe("stopped");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: OPEN, smsBlockedLine: "On hold.", recipient: { kind: "held", since: "2026-10-01T00:00:00Z" } })).toBe("unavailable");
    expect(textReadiness({ phone: null, smsGate: OPEN, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("unavailable");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: null, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("unavailable");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("unavailable");
  });
  it("Email: ready with an address and nothing stopped; stopped for any stop; otherwise unavailable (mutation: ready while stopped → FAILS)", () => {
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "ok" } })).toBe("ready");
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "stopped", since: "2026-10-01T00:00:00Z", byCustomer: true } })).toBe("stopped");
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "stopped", since: "2026-10-01T00:00:00Z", byCustomer: false, suppressed: "bounced" } })).toBe("stopped");
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "unknown" } })).toBe("unavailable");
    expect(emailReadiness({ email: null, recipient: { kind: "ok" } })).toBe("unavailable");
    expect(emailReadiness({ email: "  ", recipient: { kind: "ok" } })).toBe("unavailable");
  });
});

describe("startChannel: the whole matrix, 4 × 3 × 3 = 36 cases (spec §6 steps 1-3, G10)", () => {
  const S: Readiness[] = ["ready", "stopped", "unavailable"];
  // [lastReply, text, email] → the channel. Worked by hand from §6: preferred, then the other if ready,
  // then the one NOT stopped, then preferred.
  const CASES: [LastReply, Readiness, Readiness, "sms" | "email"][] = [
    ["sms", "ready", "ready", "sms"], ["sms", "ready", "stopped", "sms"], ["sms", "ready", "unavailable", "sms"],
    ["sms", "stopped", "ready", "email"], ["sms", "stopped", "stopped", "sms"], ["sms", "stopped", "unavailable", "email"],
    ["sms", "unavailable", "ready", "email"], ["sms", "unavailable", "stopped", "sms"], ["sms", "unavailable", "unavailable", "sms"],
    ["email", "ready", "ready", "email"], ["email", "ready", "stopped", "sms"], ["email", "ready", "unavailable", "sms"],
    ["email", "stopped", "ready", "email"], ["email", "stopped", "stopped", "email"], ["email", "stopped", "unavailable", "email"],
    ["email", "unavailable", "ready", "email"], ["email", "unavailable", "stopped", "sms"], ["email", "unavailable", "unavailable", "email"],
    ...(["other", null] as const).flatMap((last): [LastReply, Readiness, Readiness, "sms" | "email"][] => [
      [last, "ready", "ready", "sms"], [last, "ready", "stopped", "sms"], [last, "ready", "unavailable", "sms"],
      [last, "stopped", "ready", "email"], [last, "stopped", "stopped", "email"], [last, "stopped", "unavailable", "email"],
      [last, "unavailable", "ready", "email"], [last, "unavailable", "stopped", "sms"], [last, "unavailable", "unavailable", "email"],
    ]),
  ];
  it("covers every combination exactly once", () => {
    expect(CASES).toHaveLength(36);
    expect(new Set(CASES.map(([l, t, e]) => `${l}|${t}|${e}`)).size).toBe(36);
    for (const t of S) for (const e of S) expect(CASES.filter(([, ct, ce]) => ct === t && ce === e)).toHaveLength(4);
  });
  for (const [lastReply, text, email, want] of CASES) {
    it(`last reply ${lastReply ?? "none"}, Text ${text}, Email ${email} → ${want}`, () => {
      expect(startChannel({ lastReply, text, email })).toBe(want);
    });
  }
  it("never answers anything but Text or Email (decision 5: nothing sends a web chat row)", () => {
    for (const [lastReply, text, email] of CASES) expect(["sms", "email"]).toContain(startChannel({ lastReply, text, email }));
  });
});
