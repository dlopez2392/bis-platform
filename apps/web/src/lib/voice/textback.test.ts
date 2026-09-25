import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ updateMessageStatus: vi.fn(), recordUsage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const sms = vi.hoisted(() => ({
  isFake: false as boolean, redirectTo: undefined as string | undefined, send: vi.fn(),
}));
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({ isFake: sms.isFake, redirectTo: sms.redirectTo, send: (...a: unknown[]) => sms.send(...a) }),
}));

import type { serviceDb } from "@bis/db";
import { segmentsFor } from "@/lib/sms/segments";
import { deliverTextback, type PendingTextback } from "./textback";

/**
 * The text-back's usage leg. One leg covers both callers (finishCall and the
 * handoff-result route), because both deliver through deliverTextback.
 */
const DB = { tag: "service-db" } as unknown as ReturnType<typeof serviceDb>;
const BODY = "Sorry we missed you. ".repeat(9).trim();
const pending: PendingTextback = { messageId: "m_tb", conversationId: "cv1", to: "+19562921696", from: "+19565550100", body: BODY };

beforeEach(() => {
  sms.isFake = false;
  sms.redirectTo = undefined;
  sms.send.mockReset().mockResolvedValue({ providerMessageId: "sm1" });
  dbMocks.updateMessageStatus.mockReset().mockResolvedValue(undefined);
  dbMocks.recordUsage.mockReset().mockResolvedValue("recorded");
  // .mockClear(): vi.spyOn on an already-spied console.error (every test
  // after the first in this file) returns the SAME mock instance rather than
  // a fresh one, so its call history survives into the next test unless
  // cleared here. Without this, the last test's assertion sees "text-back
  // failed" calls a PRIOR test legitimately logged and fails regardless of
  // this test's own behaviour.
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("deliverTextback — usage (client billing)", () => {
  it("a delivered text-back records its segments against the message, on the same service client (mutation: bill 1 per text instead of segmentsFor → FAILS)", async () => {
    expect(segmentsFor(BODY).segments).toBe(2);
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(DB, {
      accountId: "a1", meter: "sms", quantity: 2, occurredAt: expect.any(Date), sourceRef: "message:m_tb",
    });
  });

  it("a fake provider, or a real one redirected to a developer's phone, records nothing (mutation: drop the smsBillable gate → FAILS)", async () => {
    sms.isFake = true;
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    sms.isFake = false;
    sms.redirectTo = "+19565550199";
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a text the carrier refused records nothing (mutation: record before the send → FAILS)", async () => {
    sms.send.mockRejectedValue(new Error("carrier rejected"));
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("the 'sent' write, which stores the provider id the status webhook correlates against, comes straight after the send, BEFORE the usage write (mutation: record usage before the 'sent' write → call order FAILS)", async () => {
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "sent", { providerMessageId: "sm1" }, "voice", "ai");
    expect(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.recordUsage.mock.invocationCallOrder[0]!);
  });

  it("the usage row lands even when the 'sent' write then fails (mutation: record after that write outside its finally → FAILS)", async () => {
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("db down"));
    await expect(deliverTextback(DB, "a1", pending, "finishCall call1")).resolves.toBeUndefined();
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("a failing usage write never stops the 'sent' write or reaches the text-back's failure log (mutation: remove recordUsageSafely's catch → the outer catch logs 'text-back failed', FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    await expect(deliverTextback(DB, "a1", pending, "finishCall call1")).resolves.toBeUndefined();
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "sent", { providerMessageId: "sm1" }, "voice", "ai");
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("text-back failed"));
  });
});
