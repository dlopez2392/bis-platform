import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobCheckin } from "@bis/db";

/**
 * The reconcile sweep (F-072 PR 3, from PR 2's review): a "not great" answer whose To-do did not get made (the page
 * retried a few times and gave up) gets it on a later tick, for a customer who never taps again. It runs inside the
 * `reviewRequests` key, after the check-in pass itself, and its counters ride along only when nonzero.
 */
const dbm = vi.hoisted(() => ({
  listCheckinsMissingTask: vi.fn(), ensureCheckinTask: vi.fn(), recordCheckinAnswer: vi.fn(),
  getCheckinForBooking: vi.fn(), getAutomation: vi.fn(), getBranding: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm }));

// The owner's alert has its own tests (checkin/alert.test.ts); here only WHEN the sweep asks for it is read.
const alertMock = vi.hoisted(() => ({ alertOwnerOfNotGreat: vi.fn() }));
vi.mock("@/lib/checkin/alert", () => alertMock);

import { answerCheckin } from "@/lib/checkin/flow";
import { fakeDb } from "@/lib/checkin/fake-db";
import type { PassContext } from "../context";
import { CHECKIN_SWEEP_ALERT_BUDGET_MS, CHECKIN_SWEEP_LIMIT, CHECKIN_SWEEP_WINDOW_MS, sweepCheckinTasks, reviewRequestsPass } from "./checkin-sweep";
import { reviewRequestPass } from "./review-request";

const ACCT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const NOW = new Date("2026-09-10T15:00:00Z");
const checkin = (id: string, contactId = `ct-${id}`): JobCheckin => ({
  id, accountId: ACCT, bookingId: `bk-${id}`, contactId, answer: "not_great",
  answeredAt: "2026-09-10T14:00:00.000Z", reviewLinkOpenedAt: null,
});
const { db } = fakeDb({
  contacts: [{ id: "ct-a", account_id: ACCT, first_name: "Ana", last_name: "García" }, { id: "ct-b", account_id: ACCT, first_name: "Luis", last_name: null }],
  accounts: [{ id: ACCT, language: "en" }],
});
const ctx = (): PassContext => ({ db, now: NOW, origin: "https://app.example.com", email: {} as never, sms: {} as never, closures: {} as never });

beforeEach(() => {
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.listCheckinsMissingTask.mockResolvedValue([]);
  dbm.ensureCheckinTask.mockResolvedValue({ id: "t1", created: true });
  alertMock.alertOwnerOfNotGreat.mockReset().mockResolvedValue({ sent: 1, failed: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the owner's alert from the sweep (F-072, owner decision 2026-11-17)", () => {
  const alerts = () => alertMock.alertOwnerOfNotGreat.mock.calls;

  it("a To-do the SWEEP created alerts the owner, once per check-in, through the tick's own gate (mutation: never call it -> FAILS)", async () => {
    const sendSpy = vi.fn().mockResolvedValue({ providerMessageId: "m1" });
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a"), checkin("b")]);
    await sweepCheckinTasks({ ...ctx(), email: { isFake: true, send: sendSpy } });
    expect(alerts().map((c) => c[1])).toEqual([checkin("a"), checkin("b")]);
    expect(alerts()[0]![0]).toBe(db);
    // The sender it hands over IS the tick's gate, and the tick's instant rides with it.
    const deps = alerts()[0]![2] as { send: (r: unknown) => Promise<unknown>; now: Date };
    await deps.send({ probe: 1 });
    expect(sendSpy).toHaveBeenCalledWith({ probe: 1 });
    expect(deps.now).toEqual(NOW);
  });

  it("a To-do that already existed (created: false) never alerts: the page, or an earlier tick, did (mutation: alert on every ensureCheckinTask call -> FAILS)", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    dbm.ensureCheckinTask.mockResolvedValue({ id: "t1", created: false });
    expect(await sweepCheckinTasks(ctx())).toEqual({});
    expect(alerts()).toHaveLength(0);
  });

  it("a To-do that cannot be made alerts nobody (the next tick retries, and alerts then)", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    dbm.ensureCheckinTask.mockRejectedValue(new Error("insert failed"));
    await sweepCheckinTasks(ctx());
    expect(alerts()).toHaveLength(0);
  });

  it("no addresses is counted under its own name, a failed send under its own, and neither stops the next check-in", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a"), checkin("b"), checkin("c")]);
    alertMock.alertOwnerOfNotGreat
      .mockResolvedValueOnce({ sent: 0, failed: 0, skipped: "no_recipients" })
      .mockResolvedValueOnce({ sent: 0, failed: 1 })
      .mockResolvedValueOnce({ sent: 2, failed: 0 });
    expect(await sweepCheckinTasks(ctx())).toEqual({
      checkinTasksOpened: 3, checkinAlertsNoRecipients: 1, checkinAlertsFailed: 1, checkinAlertsSent: 1,
    });
  });

  it("an alert that throws anyway is counted failed and the To-do stands (mutation: let it throw out of the loop -> FAILS)", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a"), checkin("b")]);
    alertMock.alertOwnerOfNotGreat.mockRejectedValueOnce(new Error("mail down"));
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksOpened: 2, checkinAlertsFailed: 1, checkinAlertsSent: 1 });
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(2);
  });

  it("a suppressed account (a demo tenant) is its own skip, never a failure", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    alertMock.alertOwnerOfNotGreat.mockResolvedValue({ sent: 0, failed: 0, skipped: "suppressed" });
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksOpened: 1, checkinAlertsSuppressed: 1 });
  });

  it("ONE shared time budget for the tick's alerts: once it is spent, the remaining To-dos are still made, their alerts are skipped for time and counted (mutation: no budget -> FAILS)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const many = Array.from({ length: 10 }, (_, i) => checkin(`t${i}`, "ct-a"));
      dbm.listCheckinsMissingTask.mockResolvedValue(many);
      // Each alert takes 6 s of wall clock (a slow provider that still answers inside the single alert's own cap).
      alertMock.alertOwnerOfNotGreat.mockImplementation(async () => { vi.setSystemTime(Date.now() + 6000); return { sent: 1, failed: 0 }; });
      const out = await sweepCheckinTasks(ctx());
      const tried = Math.ceil(CHECKIN_SWEEP_ALERT_BUDGET_MS / 6000);
      expect(alertMock.alertOwnerOfNotGreat).toHaveBeenCalledTimes(tried);
      expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(10);
      expect(out).toEqual({ checkinTasksOpened: 10, checkinAlertsSent: tried, checkinAlertsSkippedForTime: 10 - tried });
      expect(CHECKIN_SWEEP_ALERT_BUDGET_MS).toBeLessThanOrEqual(25_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed or missing alert never reddens the heartbeat: the To-do is the record", () => {
    expect(reviewRequestsPass.beatFailure!({ checkinAlertsFailed: 3, checkinAlertsNoRecipients: 2 })).toBeNull();
  });
});

describe("sweepCheckinTasks", () => {
  it("opens the To-do for each not-great answer that has none: due now, titled for the customer, as the system (mutation: skip the call -> FAILS)", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a"), checkin("b")]);
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksOpened: 2, checkinAlertsSent: 2 });
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(2);
    expect(dbm.ensureCheckinTask).toHaveBeenCalledWith(
      db, ACCT, checkin("a"), { title: "Call Ana García: they said the job was not great", dueAt: NOW.toISOString() }, "checkin-sweep", "system");
    expect(dbm.ensureCheckinTask.mock.calls[1]![3].title).toBe("Call Luis: they said the job was not great");
  });

  it("looks only a bounded way back and a bounded number deep (the sweep's work per tick is bounded whatever the table holds)", async () => {
    await sweepCheckinTasks(ctx());
    expect(dbm.listCheckinsMissingTask).toHaveBeenCalledWith(db, new Date(NOW.getTime() - CHECKIN_SWEEP_WINDOW_MS).toISOString(), CHECKIN_SWEEP_LIMIT);
    expect(CHECKIN_SWEEP_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    expect(CHECKIN_SWEEP_LIMIT).toBeLessThanOrEqual(50);
  });

  it("a full page is counted checkinSweepPageFull (there may be more task-missing rows than this tick looked at)", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue(Array.from({ length: CHECKIN_SWEEP_LIMIT }, (_, i) => checkin(`a${i}`, "ct-a")));
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksOpened: CHECKIN_SWEEP_LIMIT, checkinAlertsSent: CHECKIN_SWEEP_LIMIT, checkinSweepPageFull: 1 });
  });

  it("the To-do's title reads the contact in the CHECK-IN's account, never another's (mutation: drop taskTitle's account filter -> FAILS)", async () => {
    const world = fakeDb({
      contacts: [
        { id: "ct-a", account_id: "other-account", first_name: "Wrong", last_name: "Person" },
        { id: "ct-a", account_id: ACCT, first_name: "Ana", last_name: "García" },
      ],
      accounts: [{ id: ACCT, language: "en" }],
    });
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    await sweepCheckinTasks({ ...ctx(), db: world.db });
    expect(dbm.ensureCheckinTask.mock.calls[0]![3].title).toBe("Call Ana García: they said the job was not great");
  });

  it("says nothing on a quiet tick: no counters at all", async () => {
    expect(await sweepCheckinTasks(ctx())).toEqual({});
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("a To-do that turns out to exist already (created: false) is not counted as opened", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    dbm.ensureCheckinTask.mockResolvedValue({ id: "t1", created: false });
    expect(await sweepCheckinTasks(ctx())).toEqual({});
  });

  it("one To-do that cannot be made is counted and does not stop the next (error isolation, honest counter)", async () => {
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a"), checkin("b")]);
    dbm.ensureCheckinTask.mockRejectedValueOnce(new Error("insert failed")).mockResolvedValueOnce({ id: "t2", created: true });
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksOpened: 1, checkinTasksFailed: 1, checkinAlertsSent: 1 });
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(2);
  });

  it("a list that cannot be read is one counted failure, never a throw", async () => {
    dbm.listCheckinsMissingTask.mockRejectedValue(new Error("db down"));
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksFailed: 1 });
    expect(dbm.ensureCheckinTask).not.toHaveBeenCalled();
  });

  it("PR 2's gap, closed: an answer whose To-do insert failed at answer time gets its To-do on a LATER tick (mutation: remove the sweep -> FAILS)", async () => {
    const tasks = new Set<string>();
    const answered = checkin("a");
    dbm.recordCheckinAnswer.mockResolvedValue({ status: "recorded", checkin: answered });
    dbm.ensureCheckinTask.mockRejectedValue(new Error("To-do insert failed"));
    const payload = { v: 1 as const, a: ACCT, b: answered.bookingId, l: "en" as const, i: NOW.getTime() };
    // The customer taps; the answer is recorded, the To-do is not made, and they are thanked.
    expect(await answerCheckin(db, payload, "not_great", NOW)).toBe("done");
    expect(tasks.size).toBe(0);
    // The database as it would stand: the answer is there, its To-do is not.
    dbm.listCheckinsMissingTask.mockImplementation(async () => (tasks.has("a") ? [] : [answered]));
    dbm.ensureCheckinTask.mockReset().mockImplementation(async (_db, _acct, c: JobCheckin) => { tasks.add(c.id); return { id: "t1", created: true }; });
    // A later tick: the sweep makes it, once.
    expect(await sweepCheckinTasks(ctx())).toEqual({ checkinTasksOpened: 1, checkinAlertsSent: 1 });
    expect(await sweepCheckinTasks(ctx())).toEqual({});
    expect([...tasks]).toEqual(["a"]);
  });
});

describe("the reviewRequests key: the check-in pass, then the sweep", () => {
  const main = vi.spyOn(reviewRequestPass, "run");
  beforeEach(() => { main.mockReset(); });

  it("is the review request's own key, so the cron's JSON keeps its shape", () => {
    expect(reviewRequestsPass.key).toBe("reviewRequests");
  });

  it("its heartbeat goes red for a check-in with no link and for a To-do that cannot be made, and only then", () => {
    const beat = reviewRequestsPass.beatFailure!;
    expect(beat({ sent: 3, skippedNoLink: 1 })).toMatch(/no link can be made/);
    expect(beat({ checkinTasksFailed: 2 })).toMatch(/2 To-do/);
    expect(beat({ sent: 1, skippedRecentlyAsked: 4, waitingForCheckin: 2, expiredCheckin: 1, checkinSweepPageFull: 1 })).toBeNull();
    expect(beat({})).toBeNull();
  });

  it("returns the pass's counters UNCHANGED on a quiet tick (byte-identical for every account without the feature)", async () => {
    main.mockResolvedValue({ sent: 1, failed: 0 });
    expect(await reviewRequestsPass.run(ctx())).toEqual({ sent: 1, failed: 0 });
  });

  it("adds the sweep's counters beside the pass's when it did something", async () => {
    main.mockResolvedValue({ sent: 1 });
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    expect(await reviewRequestsPass.run(ctx())).toEqual({ sent: 1, checkinTasksOpened: 1, checkinAlertsSent: 1 });
  });

  it("the sweep runs even when the pass itself fails outright, and the failure still reaches the harness", async () => {
    main.mockRejectedValue(new Error("due list down"));
    dbm.listCheckinsMissingTask.mockResolvedValue([checkin("a")]);
    await expect(reviewRequestsPass.run(ctx())).rejects.toThrow("due list down");
    expect(dbm.ensureCheckinTask).toHaveBeenCalledTimes(1);
  });
});
