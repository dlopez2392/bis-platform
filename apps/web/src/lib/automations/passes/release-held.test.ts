import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({ listReleasableHolds: vi.fn(), recordAutomationLog: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const releasers = vi.hoisted(() => ({
  reminders: vi.fn(), followups: vi.fn(), review: vi.fn(), noShow: vi.fn(), sms: vi.fn(), instant: vi.fn(),
}));
vi.mock("./reminders", () => ({ releaseReminder: (...a: unknown[]) => releasers.reminders(...a) }));
vi.mock("./followups", () => ({ releaseFollowup: (...a: unknown[]) => releasers.followups(...a) }));
vi.mock("./review-request", () => ({ releaseReviewRequest: (...a: unknown[]) => releasers.review(...a) }));
vi.mock("./no-show-nudge", () => ({ releaseNoShowNudge: (...a: unknown[]) => releasers.noShow(...a) }));
vi.mock("./sms-reminder", () => ({ releaseSmsReminder: (...a: unknown[]) => releasers.sms(...a) }));
vi.mock("../instant-reply", () => ({ releaseInstantReply: (...a: unknown[]) => releasers.instant(...a) }));

import type { PassContext } from "../context";
import { releaseHeldPass, RELEASERS, RELEASE_BATCH, RELEASE_BUDGET_MS } from "./release-held";

const NOW = new Date("2026-09-22T13:00:00Z");
const row = (source: AutomationLogRow["source"], key: string): AutomationLogRow => ({
  id: `log_${key}`, account_id: "acct_1", source, channel: source === "voice" ? "ai" : "sms", contact_id: null,
  subject_key: key, status: "held", reason: "x", held_until: "2026-09-22T13:00:00.000Z", payload: {}, occurred_at: "2026-09-22T04:00:00.000Z",
});
const ctx: PassContext = {
  db: {} as never, now: NOW, origin: "https://app.example.com",
  email: { isFake: true, send: async () => ({ providerMessageId: "e" }) }, sms: () => ({ isFake: true, send: async () => ({ providerMessageId: "s" }) }),
  quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
};

beforeEach(() => {
  for (const fn of [...Object.values(dbMocks), ...Object.values(releasers)]) fn.mockReset();
  dbMocks.listReleasableHolds.mockResolvedValue([]);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("releaseHeldPass", () => {
  it("reads the queue at the tick's own instant with the batch size, and hands each row to ITS source's releaser (mutation: swap two map entries → FAILS)", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([
      row("reminders", "booking:1"), row("followups", "booking:2"), row("review_request", "booking:3"),
      row("no_show_nudge", "booking:4"), row("sms_reminder", "booking:5"), row("instant_reply", "submission:6"),
    ]);
    releasers.reminders.mockResolvedValue("sent"); releasers.followups.mockResolvedValue("held");
    releasers.review.mockResolvedValue("skipped"); releasers.noShow.mockResolvedValue("failed");
    releasers.sms.mockResolvedValue("sent"); releasers.instant.mockResolvedValue("sent");

    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 6, sent: 3, held: 1, skipped: 1, failed: 1, errored: 0, deferred: 0 });
    expect(dbMocks.listReleasableHolds).toHaveBeenCalledWith(expect.anything(), NOW.toISOString(), RELEASE_BATCH);
    expect(releasers.reminders).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:1" }));
    expect(releasers.followups).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:2" }));
    expect(releasers.review).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:3" }));
    expect(releasers.noShow).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:4" }));
    expect(releasers.sms).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:5" }));
    expect(releasers.instant).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "submission:6" }));
  });

  it("only the three non-releasable sources map to null — every recipe source has a real releaser", () => {
    // Written as the list of NULLS, not the list of functions, so it never
    // needs to grow again: each of part B's four recipes is caught by this
    // case the moment its source is registered, whether or not anyone
    // remembers to come back here. A releaser left `null` type-checks and
    // then drops every held row of that source as "No longer due".
    const nulls = Object.entries(RELEASERS).filter(([, r]) => r === null).map(([k]) => k).sort();
    expect(nulls).toEqual(["concierge", "voice", "weekly_report"]);
  });

  it("RELEASE_BATCH is pinned at 200", () => {
    expect(RELEASE_BATCH).toBe(200);
  });

  it("RELEASE_BUDGET_MS is pinned at 60 seconds", () => {
    expect(RELEASE_BUDGET_MS).toBe(60_000);
  });

  it("a releaser that throws is counted errored and the next row still runs (mutation: drop the per-row try/catch → FAILS)", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([row("reminders", "booking:1"), row("sms_reminder", "booking:2")]);
    releasers.reminders.mockRejectedValue(new Error("db exploded"));
    releasers.sms.mockResolvedValue("sent");
    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 2, sent: 1, held: 0, skipped: 0, failed: 0, errored: 1, deferred: 0 });
    expect(releasers.sms).toHaveBeenCalledTimes(1);
  });

  it("a held row from a source that cannot be held (voice, concierge, the weekly report) is skipped as 'No longer due' so it leaves the queue (mutation: point weekly_report/concierge at a real releaser → reds)", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([
      row("voice", "call:9"), row("concierge", "conversation:8"), row("weekly_report", "week:2026-09-14"),
    ]);
    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 3, sent: 0, held: 0, skipped: 3, failed: 0, errored: 0, deferred: 0 });
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(3);
    for (const [source, key] of [
      ["voice", "call:9"], ["concierge", "conversation:8"], ["weekly_report", "week:2026-09-14"],
    ] as const) {
      expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        source, subjectKey: key, status: "skipped", reason: "No longer due",
      }));
    }
  });

  it("an empty queue is one read and no writes", async () => {
    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0, deferred: 0 });
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });
});

describe("releaseHeldPass — the wall-clock budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops early once the budget is spent, deferring the remainder to the next tick without calling their releasers (mutation: delete the guard → FAILS)", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([
      row("reminders", "booking:1"), row("followups", "booking:2"), row("sms_reminder", "booking:3"),
    ]);
    releasers.reminders.mockResolvedValue("sent");
    releasers.followups.mockResolvedValue("sent");
    releasers.sms.mockResolvedValue("sent");

    // Three calls the pass makes to Date.now(): once for `startedAt`, then
    // once per row BEFORE that row is processed. Row 1's check reads "no
    // time has passed" (still 0); row 2's check reads past the budget, so
    // the loop stops there — row 2 and row 3's releasers never run.
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)                          // startedAt
      .mockReturnValueOnce(0)                          // check before row 1 — inside budget
      .mockReturnValueOnce(RELEASE_BUDGET_MS + 1);      // check before row 2 — budget spent

    expect(await releaseHeldPass.run(ctx)).toEqual({
      examined: 1, sent: 1, held: 0, skipped: 0, failed: 0, errored: 0, deferred: 2,
    });
    expect(releasers.reminders).toHaveBeenCalledTimes(1);
    expect(releasers.followups).not.toHaveBeenCalled();
    expect(releasers.sms).not.toHaveBeenCalled();
  });

  it("with the real clock, a comfortably-sized batch defers nothing", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([row("reminders", "booking:1"), row("followups", "booking:2")]);
    releasers.reminders.mockResolvedValue("sent");
    releasers.followups.mockResolvedValue("sent");

    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 2, sent: 2, held: 0, skipped: 0, failed: 0, errored: 0, deferred: 0 });
  });
});
