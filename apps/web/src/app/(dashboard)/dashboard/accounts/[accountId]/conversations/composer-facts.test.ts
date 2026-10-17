import { describe, it, expect, vi } from "vitest";
import { loadInboxComposer, type InboxComposerDeps } from "./composer-facts";

const OPEN = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
const ANA = { phone: "(956) 555-0100", email: "ana@example.com", phone_country_unconfirmed: false };
const deps = (over: Partial<InboxComposerDeps> = {}): InboxComposerDeps => ({
  contact: vi.fn(async () => ANA), gate: vi.fn(async () => OPEN),
  smsState: vi.fn(async () => ({ kind: "ok" as const })), emailState: vi.fn(async () => ({ kind: "ok" as const })),
  log: vi.fn(), ...over,
});
const ctx = (messages: { direction: string; channel: string; author_kind?: string | null }[], locale: "en" | "es" = "en") => ({ messages, zone: "UTC", locale });

describe("loadInboxComposer: the inbox composer's facts, decided on the server (spec §6)", () => {
  it("opens on the channel of their last text or email when it is ready (mutation: ignore lastReply → 'sms', FAILS)", async () => {
    const f = await loadInboxComposer(deps(), ctx([{ direction: "inbound", channel: "sms", author_kind: "customer" }, { direction: "inbound", channel: "email", author_kind: "customer" }]));
    expect(f).toEqual({ contactHasEmail: true, contactHasPhone: true, smsGate: OPEN, smsBlockedLine: null, emailNoticeLine: null, initialMode: "email" });
  });

  it("after a web chat it opens on Text when their number is cleared, otherwise Email (decision 2; mutation: preferred 'email' for 'other' → FAILS)", async () => {
    const chat = [{ direction: "inbound", channel: "webchat", author_kind: "customer" }];
    expect((await loadInboxComposer(deps(), ctx(chat))).initialMode).toBe("sms");
    expect((await loadInboxComposer(deps({ gate: vi.fn(async () => null) }), ctx(chat))).initialMode).toBe("email");
  });

  it("their texts stopped: never opens on Text, and the line is today's, in the staff member's language (mutation: pass the English locale → FAILS)", async () => {
    const d = deps({ smsState: vi.fn(async () => ({ kind: "stopped" as const, since: "not a time" })) });
    const f = await loadInboxComposer(d, ctx([{ direction: "inbound", channel: "sms", author_kind: "customer" }], "es"));
    expect(f.initialMode).toBe("email");
    expect(f.smsBlockedLine).toBe("Dejó de recibir sus textos. No puede mandarle textos a este número hasta que mande START.");
  });

  it("an unreadable contact: nothing is ready, no state is read, one fixed log line with no customer data (mutation: rethrow → the page fails, FAILS; read the ledger anyway → FAILS)", async () => {
    const d = deps({ contact: vi.fn(async () => { throw new Error("rls ana@example.com"); }) });
    const f = await loadInboxComposer(d, ctx([]));
    expect(f).toEqual({ contactHasEmail: false, contactHasPhone: false, smsGate: OPEN, smsBlockedLine: null, emailNoticeLine: null, initialMode: "email" });
    expect(d.smsState).not.toHaveBeenCalled();
    expect(d.emailState).not.toHaveBeenCalled();
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ")).not.toContain("ana@");
  });

  it("an unusable number is no phone, the way sendSmsAction reads it (mutation: Boolean(phone) → true, FAILS)", async () => {
    const f = await loadInboxComposer(deps({ contact: vi.fn(async () => ({ ...ANA, phone: "12" })) }), ctx([]));
    expect(f.contactHasPhone).toBe(false);
    expect(f.initialMode).toBe("email");
  });
});
