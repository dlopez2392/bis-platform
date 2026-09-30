import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(), recordUsage: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import type { PassContext } from "./context";
import {
  sendAutomationSms, markAutomationSmsSent, smsCooldownActive, SmsBlocked, SmsDeferred, LEDGER_RETRY_MS, type AutomationSmsInput,
} from "./send-sms";
import { fakeSmsGate } from "@/lib/consent/fake-gate";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { segmentsFor } from "@/lib/sms/segments";

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
const gateSend = vi.fn(async (m: { to: string; from: string; body: string }) => smsSend(m));
function ctx(over: Partial<PassContext> = {}): PassContext {
  return {
    db: {} as never, now: NOW, origin: "https://app.example.com",
    email: { isFake: true, send: async () => ({ providerMessageId: "e" }) },
    sms: fakeSmsGate({ send: gateSend }),
    ...over,
  };
}
const input = (onProviderFailure = vi.fn(async () => {})): AutomationSmsInput => ({
  accountId: "acct_1", contactId: "ct_1", kind: "automation.sms_reminder", to: "(956) 555-0101", body: "hi",
  accountTimezone: "America/Chicago", onProviderFailure,
});

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendAutomationSms — through the send gate, write then send", () => {
  it("hands the gate the kind, the stored number, the body, the contact, the account's zone and the TICK's instant (mutation: drop `now` → the gate judges the hours at the wall clock, FAILS)", async () => {
    const gate = vi.fn(async () => ({ kind: "blocked" as const, reason: "no_number" as const }));
    await expect(sendAutomationSms(ctx({ sms: gate }), input())).rejects.toBeInstanceOf(SmsBlocked);
    expect(gate).toHaveBeenCalledWith({
      accountId: "acct_1", kind: "automation.sms_reminder", to: "(956) 555-0101", body: "hi",
      contactId: "ct_1", language: undefined, accountZone: "America/Chicago", now: NOW,
    }, { prepare: expect.any(Function) });
  });

  it("the gate's prepare writes the conversation and the message row with the text AS SENT, then the send; both ids come back (mutation: store input.body → the row lacks the STOP line, FAILS)", async () => {
    const onProviderFailure = vi.fn(async () => {});
    expect(await sendAutomationSms(ctx(), input(onProviderFailure))).toEqual({ messageId: "msg_1", providerMessageId: "s1", usage: null });
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    // Spelled out rather than wrapped in withOptOut(), so this still fails if
    // that helper quietly becomes a no-op.
    const sentBody = "hi Reply STOP to opt out.";
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: sentBody }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: sentBody });
    expect(onProviderFailure).not.toHaveBeenCalled();
  });

  it("a deferral throws SmsDeferred carrying the opening, and writes no row (mutation: return a sent result → FAILS)", async () => {
    const until = new Date("2026-09-10T13:00:00Z");
    const deferred = fakeSmsGate({ decide: () => ({ kind: "deferred", until, zone: "America/Chicago" }) });
    const e = await sendAutomationSms(ctx({ sms: deferred }), input()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SmsDeferred);
    expect((e as SmsDeferred).until).toEqual(until);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a refusal throws SmsBlocked with the gate's reason, and writes no row (mutation: swallow it → resolves, FAILS)", async () => {
    const stopped = fakeSmsGate({ decide: () => ({ kind: "blocked", reason: "stopped" }) });
    const e = await sendAutomationSms(ctx({ sms: stopped }), input()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SmsBlocked);
    expect((e as SmsBlocked).reason).toBe("stopped");
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a stale-stop-confirmation refusal, which only a consent reply can meet, is a programming error, never a skipped row (mutation: throw SmsBlocked for it → FAILS)", async () => {
    const odd = fakeSmsGate({ decide: () => ({ kind: "blocked", reason: "stop_confirmation_stale" }) });
    const e = await sendAutomationSms(ctx({ sms: odd }), input()).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(SmsBlocked);
    expect(String(e)).toMatch(/stale stop confirmation/);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("an unreadable ledger is a 15-minute re-hold, never a refusal and never a failed row that leaves the queue (review R2-I4; mutation: throw a plain Error again → FAILS)", async () => {
    const down = fakeSmsGate({ decide: () => ({ kind: "blocked", reason: "ledger_unavailable" }) });
    const e = await sendAutomationSms(ctx({ sms: down }), input()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SmsDeferred);
    expect((e as SmsDeferred).why).toBe("ledger_unavailable");
    expect((e as SmsDeferred).until.getTime()).toBe(NOW.getTime() + LEDGER_RETRY_MS);
    expect(LEDGER_RETRY_MS).toBe(15 * 60_000);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a text that LEFT is reported sent even if the gate wrote no row: logged, never thrown into a re-send (review R2 minor; mutation: throw when the row id is missing → FAILS)", async () => {
    const noRow = fakeSmsGate({ decide: () => ({ kind: "sent", providerMessageId: "p_9", to: "+19565550101", from: "+19565550000", body: "hi", billable: false, segments: 1 }) });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = await sendAutomationSms(ctx({ sms: noRow }), input());
    expect(sent).toMatchObject({ messageId: "", providerMessageId: "p_9" });
    expect(err.mock.calls.flat().join(" ")).toContain("never wrote the message row");
    await markAutomationSmsSent(ctx(), "acct_1", sent, "test");
    expect(dbMocks.updateMessageStatus).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("on a provider failure: marks the row failed, THEN runs the marker, then rethrows the provider's error (mutation: swap the order, or swallow the throw → FAILS)", async () => {
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

  it("no provider (TELNYX_API_KEY unset in production): nothing in the inbox and no attempt marker (mutation: run the marker on every failure → FAILS)", async () => {
    const onProviderFailure = vi.fn(async () => {});
    const noProvider = fakeSmsGate({ decide: () => ({
      kind: "failed", stage: "provider_unavailable", error: "TELNYX_API_KEY is required in production", carrierBlocked: false }) });
    await expect(sendAutomationSms(ctx({ sms: noProvider }), input(onProviderFailure))).rejects.toThrow(/TELNYX_API_KEY/);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(onProviderFailure).not.toHaveBeenCalled();
  });
});

describe("markAutomationSmsSent — best effort, after the stamp", () => {
  it("marks the row sent with the provider id, and swallows its own failure", async () => {
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: null }, "test");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    await expect(markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: null }, "test")).resolves.toBeUndefined();
  });
});

describe("usage: what an automation text bills (client billing)", () => {
  it("a text the gate says bills carries ITS segment count, the text as sent (mutation: count input.body → FAILS)", async () => {
    const body = "x".repeat(150);
    expect(segmentsFor(body).segments).toBe(1);
    const billing = fakeSmsGate({ send: gateSend, billable: true });
    const sent = await sendAutomationSms(ctx({ sms: billing }), { ...input(), body });
    expect(sent.usage).toEqual({ segments: 2, sentAt: expect.any(Date) });
  });

  it("a text the gate says does not bill (the fake provider, or one redirected to a developer's phone) has no usage (mutation: ignore `billable` → FAILS)", async () => {
    expect((await sendAutomationSms(ctx(), input())).usage).toBeNull();
  });

  it("markAutomationSmsSent records the segments against the message, AFTER the status write (mutation: record before the status write → call order FAILS)", async () => {
    const sentAt = new Date("2026-09-09T14:00:05Z");
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: { segments: 3, sentAt } }, "test");
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", meter: "sms", quantity: 3, occurredAt: sentAt, sourceRef: "message:msg_1",
    });
    expect(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.recordUsage.mock.invocationCallOrder[0]!);
  });

  it("records nothing for a text with no usage, and a failing usage write never escapes (mutation: ignore usage: null → FAILS; remove recordUsageSafely's catch → rejects, FAILS)", async () => {
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: null }, "test");
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    dbMocks.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    await expect(markAutomationSmsSent(ctx(), "acct_1",
      { messageId: "msg_1", providerMessageId: "s1", usage: { segments: 1, sentAt: NOW } }, "test")).resolves.toBeUndefined();
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("every module that sends with sendAutomationSms( also CALLS markAutomationSmsSent(, where its usage is recorded; comments do not count (mutation: delete one pass's markAutomationSmsSent call → that file is named here, FAILS; replace the call with a comment that names it → still named, FAILS; delete either comment-stripping regex → the stripper self-check FAILS)", () => {
    const ROOT = fileURLToPath(new URL(".", import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
    });
    const rel = (f: string) => f.slice(ROOT.length).replace(/\\/g, "/");
    // The CODE of a file: block comments, then line comments, stripped (a
    // `//` right after a `:` is a URL, not a comment), so a doc comment that
    // names the call cannot satisfy the scan.
    const code = (f: string) => readFileSync(f, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // Guards the stripper itself, both halves: a phrase only send-sms.ts's
    // BLOCK doc comment holds (mutation: delete the block-comment regex →
    // FAILS), and one only a `//` LINE comment there holds (mutation: delete
    // the line-comment regex → FAILS).
    const sendSmsSource = readFileSync(join(ROOT, "send-sms.ts"), "utf-8");
    expect(sendSmsSource).toContain("AFTER the dedupe stamp");
    expect(code(join(ROOT, "send-sms.ts"))).not.toContain("AFTER the dedupe stamp");
    expect(sendSmsSource).toContain("  // THE choke point for every unprompted text");
    expect(code(join(ROOT, "send-sms.ts"))).not.toContain("THE choke point for every unprompted text");
    const senders = walk(ROOT).filter((f) => rel(f) !== "send-sms.ts" && code(f).includes("sendAutomationSms("));
    // Guards the fixture: the seven callers on 2026-09-25. A new caller reds
    // here until it is added, which is the moment to check it bills.
    expect(senders.map(rel).sort()).toEqual([
      "instant-reply.ts", "passes/appointment-confirm.ts", "passes/no-show-nudge.ts", "passes/quote-followup.ts",
      "passes/referral-ask.ts", "passes/review-request.ts", "passes/sms-reminder.ts",
    ]);
    expect(senders.filter((f) => !code(f).includes("markAutomationSmsSent(")).map(rel)).toEqual([]);
  });
});
