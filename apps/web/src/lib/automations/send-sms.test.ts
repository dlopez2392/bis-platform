import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import type { PassContext } from "./context";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive } from "./send-sms";

const NOW = new Date("2026-09-09T14:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("smsCooldownActive — one attempt per booking per day", () => {
  it("is off with no marker, on for a marker younger than 24h, off again at exactly 24h", () => {
    // Mutation: `<=` instead of `<` and the 24h case flips.
    expect(smsCooldownActive(null, NOW)).toBe(false);
    expect(smsCooldownActive(new Date(NOW.getTime() - SMS_RETRY_COOLDOWN_MS + 60_000).toISOString(), NOW)).toBe(true);
    expect(smsCooldownActive(new Date(NOW.getTime() - SMS_RETRY_COOLDOWN_MS).toISOString(), NOW)).toBe(false);
    expect(smsCooldownActive(new Date(NOW.getTime() - 25 * HOUR).toISOString(), NOW)).toBe(false);
  });

  it("holds on a marker in the future (clock skew) and on one it cannot read — the safe direction", () => {
    expect(smsCooldownActive(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe(true);
    expect(smsCooldownActive("not a timestamp", NOW)).toBe(true);
  });

  it("pins the constant", () => {
    expect(SMS_RETRY_COOLDOWN_MS).toBe(24 * HOUR);
  });
});

const smsSend = vi.fn();
function ctx(): PassContext {
  return {
    db: {} as never, now: NOW, origin: "https://app.example.com",
    email: { isFake: true, send: async () => ({ providerMessageId: "e" }) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
    quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
  };
}
const input = (onProviderFailure = vi.fn(async () => {})) => ({
  accountId: "acct_1", contactId: "ct_1", to: "+19565550101", from: "+19565550000", body: "hi", onProviderFailure,
});

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendAutomationSms — write then send, the sendSmsAction discipline, written once", () => {
  it("provider → conversation → message row → send, returning both ids; the marker is NOT written on success", async () => {
    const onProviderFailure = vi.fn(async () => {});
    expect(await sendAutomationSms(ctx(), input(onProviderFailure))).toEqual({ messageId: "msg_1", providerMessageId: "s1" });
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    // The opt-out disclosure is appended HERE, at the one choke point every
    // scheduled text goes through, and the SAME string is stored and sent —
    // an operator reading the thread must not see a shorter message than the
    // customer received. Spelled out rather than wrapped in withOptOut() so
    // this assertion still fails if that helper quietly becomes a no-op.
    const sentBody = "hi Reply STOP to opt out.";
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: sentBody }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: sentBody });
    expect(onProviderFailure).not.toHaveBeenCalled();
  });

  it("on a provider failure: marks the row failed, THEN runs the marker, then rethrows the provider's error", async () => {
    // Mutation: swap the order, or swallow the throw.
    const order: string[] = [];
    dbMocks.updateMessageStatus.mockImplementation(async () => { order.push("failed"); });
    const onProviderFailure = vi.fn(async () => { order.push("marker"); });
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    await expect(sendAutomationSms(ctx(), input(onProviderFailure))).rejects.toThrow("carrier timeout");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(order).toEqual(["failed", "marker"]);
  });

  it("a marker that itself throws is logged and swallowed; the provider's error still propagates", async () => {
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    const onProviderFailure = vi.fn(async () => { throw new Error("db down"); });
    await expect(sendAutomationSms(ctx(), input(onProviderFailure))).rejects.toThrow("carrier timeout");
    expect(onProviderFailure).toHaveBeenCalledTimes(1);
  });

  it("constructs the provider BEFORE any row is written, so a throwing factory leaves nothing in the inbox", async () => {
    const c: PassContext = { ...ctx(), sms: () => { throw new Error("TELNYX_API_KEY is required in production"); } };
    await expect(sendAutomationSms(c, input())).rejects.toThrow(/TELNYX_API_KEY/);
    expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });
});

describe("markAutomationSmsSent — best effort, after the stamp", () => {
  it("marks the row sent with the provider id, and swallows its own failure", async () => {
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1" }, "test");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    await expect(markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1" }, "test")).resolves.toBeUndefined();
  });
});

describe("sendAutomationSms — the opt-out disclosure", () => {
  it("writes it in the language the caller names, for the instant reply's sake", async () => {
    // The scheduled passes have no locale and take the English default; the
    // form instant reply picks its body by locale and passes that same locale
    // here. A Spanish reply ending in an English sentence would undo the
    // point of having a bodyEs at all.
    await sendAutomationSms(ctx(), { ...input(vi.fn(async () => {})), body: "hola", language: "es" });
    expect(smsSend).toHaveBeenCalledWith(expect.objectContaining({
      body: "hola Responde STOP para cancelar.",
    }));
  });

  it("does not append a second one to a body that already says it", async () => {
    await sendAutomationSms(ctx(), {
      ...input(vi.fn(async () => {})), body: "See you tomorrow. Reply STOP to opt out.",
    });
    expect(smsSend).toHaveBeenCalledWith(expect.objectContaining({
      body: "See you tomorrow. Reply STOP to opt out.",
    }));
  });
});
