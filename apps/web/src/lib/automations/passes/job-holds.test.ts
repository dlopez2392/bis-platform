import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-046 part 1 (plan Task 9): the backstop for a staff job's Undo hold. The settle itself (the claim, the
 * events, the email, its gate and its too-late rule) is job-hold.test.ts's; here the settle is a spy, and
 * these cases pin what the PASS owns: which rows it reads (two minutes of slack, a batch of 25), that each
 * one is settled through THIS tick's email gate and clock, the counters, and the wall-clock budget.
 */
const m = vi.hoisted(() => ({
  /** Every dereference of `listDueJobHolds` on the mocked module: the pass must make none at import. */
  derefs: 0,
  list: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@bis/db", () => ({
  get listDueJobHolds() { m.derefs++; return m.list; },
}));
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/job-hold", () => ({ settleJobHold: m.settle }));

import { jobHoldsPass, JOB_HOLD_SWEEP_SLACK_MS, JOB_HOLD_SWEEP_BATCH, JOB_HOLD_BUDGET_MS } from "./job-holds";
import type { PassContext } from "../context";

const DB = { tick: true };
const NOW = Date.parse("2026-11-02T15:00:00.000Z");
const ORIGIN = "https://app.example.com";
const tickSends = vi.fn();
const ctx = (): PassContext => ({
  db: DB as never, now: new Date(NOW), origin: ORIGIN,
  email: { isFake: true, send: tickSends }, sms: {} as never, closures: {} as never,
});
const row = (id: string, accountId = "acct_1") => ({ accountId, bookingId: id, holdUntil: "2026-11-02T14:50:00.000Z" });
const EMPTY = { sent: 0, failed: 0, quiet: 0, tooLate: 0, lost: 0, deferred: 0 };

beforeEach(() => {
  vi.restoreAllMocks();
  m.list.mockReset().mockResolvedValue([]);
  m.settle.mockReset().mockResolvedValue("sent");
  tickSends.mockReset().mockResolvedValue({ providerMessageId: "re_tick" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("jobHoldsPass — the read", () => {
  it("dereferences no @bis/db export at module scope (the cron route test's bare mock throws on one)", () => {
    expect(m.derefs).toBe(0);
  });

  it("reads holds due at least two minutes before the tick, 25 at most, on the tick's own client (mutation: no slack → it races a live after(), FAILS)", async () => {
    expect(await jobHoldsPass.run(ctx())).toEqual(EMPTY);
    expect(m.list).toHaveBeenCalledTimes(1);
    expect(m.list).toHaveBeenCalledWith(DB, new Date(NOW - 2 * 60 * 1000).toISOString(), 25);
    expect(JOB_HOLD_SWEEP_SLACK_MS).toBe(120_000);
    expect(JOB_HOLD_SWEEP_BATCH).toBe(25);
    expect(m.settle).not.toHaveBeenCalled();
  });

  it("a failed read is the pass's failure (the harness isolates it as errored), never a quiet zero", async () => {
    m.list.mockRejectedValue(new Error("listDueJobHolds failed: boom"));
    await expect(jobHoldsPass.run(ctx())).rejects.toThrow("listDueJobHolds failed: boom");
  });
});

describe("jobHoldsPass — the settle", () => {
  it("settles every row it read, oldest first, a suppressed account's included (the read keeps them; the gate refuses the send), with the tick's db, origin and now (mutation: drop a row or reorder → FAILS)", async () => {
    m.list.mockResolvedValue([row("bk_a"), row("bk_b", "acct_suppressed")]);
    await jobHoldsPass.run(ctx());
    expect(m.settle.mock.calls.map(([a, b]) => [a, b])).toEqual([["acct_1", "bk_a"], ["acct_suppressed", "bk_b"]]);
    for (const [, , deps] of m.settle.mock.calls) {
      expect(deps.db).toBe(DB);
      expect(deps.origin).toBe(ORIGIN);
      expect(deps.now().getTime()).toBe(NOW);
    }
  });

  it("sends through THIS tick's email gate, never the after() path's own (mutation: omit `send` → settleJobHold falls back to sendEmailOrThrow, FAILS)", async () => {
    m.list.mockResolvedValue([row("bk_a")]);
    await jobHoldsPass.run(ctx());
    const deps = m.settle.mock.calls[0]![2];
    expect(typeof deps.send).toBe("function");
    const req = { accountId: "acct_1", kind: "staff.booking_confirmation", to: "ana@example.com" };
    await expect(deps.send(req)).resolves.toEqual({ providerMessageId: "re_tick" });
    expect(tickSends).toHaveBeenCalledWith(req);
  });

  it("counts each outcome under its own counter, too_late as tooLate (mutation: count too_late as quiet → FAILS)", async () => {
    m.list.mockResolvedValue(["a", "b", "c", "d", "e", "f"].map((x) => row(`bk_${x}`)));
    for (const o of ["sent", "failed", "quiet", "too_late", "lost", "sent"]) m.settle.mockResolvedValueOnce(o);
    expect(await jobHoldsPass.run(ctx())).toEqual({ sent: 2, failed: 1, quiet: 1, tooLate: 1, lost: 1, deferred: 0 });
  });
});

describe("jobHoldsPass — the budget", () => {
  it("stops STARTING rows once JOB_HOLD_BUDGET_MS of wall clock is spent, and counts the rest as deferred (mutation: no budget check → all three settle this tick, FAILS)", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    m.settle.mockImplementation(async () => { clock += 6_000; return "sent"; });
    m.list.mockResolvedValue([row("bk_a"), row("bk_b"), row("bk_c")]);
    expect(await jobHoldsPass.run(ctx())).toEqual({ ...EMPTY, sent: 2, deferred: 1 });
    expect(m.settle.mock.calls.map(([, b]) => b)).toEqual(["bk_a", "bk_b"]);
    expect(JOB_HOLD_BUDGET_MS).toBe(10_000);
  });

  it("a row started just inside the budget still runs (the check is before a row, never during one)", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    m.settle.mockImplementation(async () => { clock += JOB_HOLD_BUDGET_MS - 1; return "quiet"; });
    m.list.mockResolvedValue([row("bk_a"), row("bk_b")]);
    expect(await jobHoldsPass.run(ctx())).toEqual({ ...EMPTY, quiet: 2 });
  });
});
