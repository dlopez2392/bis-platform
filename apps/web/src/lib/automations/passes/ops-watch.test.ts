import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  listHeartbeats: vi.fn(),
  markAlerted: vi.fn(),
  getAgencyReportTarget: vi.fn(),
}));
vi.mock("@bis/db", () => db);

import { opsWatchPass, OPS_ALERT_FALLBACK } from "./ops-watch";
import type { PassContext } from "../context";

const NOW = new Date("2026-10-01T15:00:00Z");
const iso = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();
const row = (over: Record<string, unknown>) => ({ lastOkAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0, alertedAt: null, ...over });

function ctx(send = vi.fn().mockResolvedValue({ providerMessageId: "m1" })) {
  return { c: { db: {} as never, now: NOW, origin: "https://app.example.com", email: { isFake: true, send }, sms: vi.fn() } as unknown as PassContext, send };
}

beforeEach(() => {
  db.listHeartbeats.mockReset();
  db.markAlerted.mockReset().mockResolvedValue(undefined);
  db.getAgencyReportTarget.mockReset().mockResolvedValue({ agencyId: "ag1", reportEmail: "ops@agency.example", timezone: "America/Chicago", lastSentWeek: null });
  delete process.env.AGENCY_SUPPORT_EMAIL;
});

describe("opsWatchPass — the operational floor's alert pass (spec §2)", () => {
  it("all quiet: no email, no marks, no agency read", async () => {
    db.listHeartbeats.mockResolvedValue([row({ key: "cron.pass.reminders", lastOkAt: iso(1) }), row({ key: "cron.tick", lastOkAt: iso(1) })]);
    const { c, send } = ctx();
    expect(await opsWatchPass.run(c)).toEqual({ alerted: 0, recovered: 0, sent: 0, failed: 0, unmarked: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(db.getAgencyReportTarget).not.toHaveBeenCalled();
  });

  it("a pass failing twice is emailed to the agency as operator.ops_alert, then marked (mutation: mark before send → the failed-send test below FAILS)", async () => {
    db.listHeartbeats.mockResolvedValue([row({ key: "cron.pass.reminders", consecutiveFailures: 2, lastErrorAt: iso(1), lastError: "boom" })]);
    const { c, send } = ctx();
    const counters = await opsWatchPass.run(c);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ accountId: null, kind: "operator.ops_alert", to: "ops@agency.example" });
    expect(db.markAlerted).toHaveBeenCalledWith(c.db, "cron.pass.reminders", NOW);
    expect(counters).toMatchObject({ alerted: 1, sent: 1 });
  });

  it("a send that fails marks nothing, so the next tick tries again (a duplicate beats a lost alert)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.listHeartbeats.mockResolvedValue([row({ key: "cron.pass.reminders", consecutiveFailures: 3, lastErrorAt: iso(1) })]);
    const { c } = ctx(vi.fn().mockRejectedValue(new Error("resend down")));
    expect(await opsWatchPass.run(c)).toMatchObject({ failed: 1, alerted: 0 });
    expect(db.markAlerted).not.toHaveBeenCalled();
  });

  it("a recovered key is cleared after its one 'back to normal' email", async () => {
    db.listHeartbeats.mockResolvedValue([row({ key: "cron.pass.reminders", lastOkAt: iso(1), lastErrorAt: iso(20), alertedAt: iso(19) })]);
    const { c, send } = ctx();
    expect(await opsWatchPass.run(c)).toMatchObject({ recovered: 1, sent: 1 });
    expect(send.mock.calls[0]![0].subject).toBe("BIS platform: back to normal");
    expect(db.markAlerted).toHaveBeenCalledWith(c.db, "cron.pass.reminders", null);
  });

  it("no agency report address: AGENCY_SUPPORT_EMAIL, then hello@bis-rgv.com (decision 4)", async () => {
    db.listHeartbeats.mockResolvedValue([row({ key: "cron.pass.reminders", consecutiveFailures: 2, lastErrorAt: iso(1) })]);
    db.getAgencyReportTarget.mockResolvedValue({ agencyId: "ag1", reportEmail: null, timezone: "America/Chicago", lastSentWeek: null });
    const first = ctx();
    await opsWatchPass.run(first.c);
    expect(first.send.mock.calls[0]![0].to).toBe(OPS_ALERT_FALLBACK);
    expect(OPS_ALERT_FALLBACK).toBe("hello@bis-rgv.com");

    process.env.AGENCY_SUPPORT_EMAIL = "support@agency.example";
    const second = ctx();
    await opsWatchPass.run(second.c);
    expect(second.send.mock.calls[0]![0].to).toBe("support@agency.example");
  });

  it("a mark that fails after a good send is counted, not thrown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.listHeartbeats.mockResolvedValue([row({ key: "cron.pass.reminders", consecutiveFailures: 2, lastErrorAt: iso(1) })]);
    db.markAlerted.mockRejectedValue(new Error("db blip"));
    const { c } = ctx();
    expect(await opsWatchPass.run(c)).toMatchObject({ sent: 1, unmarked: 1, alerted: 0 });
  });
});
