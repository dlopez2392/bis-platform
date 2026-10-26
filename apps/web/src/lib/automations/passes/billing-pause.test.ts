import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listPauseCandidates: vi.fn(), pauseBilling: vi.fn(), clearBillingPause: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { AccountBilling } from "@bis/db";
import type { PassContext } from "../context";
import { NO_CLOSURES } from "../closures";
import { billingPausePass } from "./billing-pause";

/** M7a PR-4, Task 4 (plan G1, G16; m4). */

const TICK = new Date("2026-10-26T12:00:00.000Z");
const T = TICK.getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(T - ms).toISOString();

function row(id: string, over: Partial<AccountBilling> = {}): AccountBilling {
  return {
    accountId: id, planId: "plan_1", complimentary: false,
    stripeCustomerId: `cus_${id}`, stripeSubscriptionId: `sub_${id}`, subscriptionStatus: "active",
    currentPeriodStart: ago(10 * DAY), currentPeriodEnd: ago(-20 * DAY),
    pastDueSince: null, billingPausedAt: null, pauseLiftedAt: null, stripeCheckedAt: null,
    billingStartedAt: ago(90 * DAY), createdAt: ago(90 * DAY),
    // PostgREST's microsecond form; the write cases give each row its own.
    updatedAt: "2026-10-25T00:00:00.000001+00:00",
    ...over,
  };
}
/** past_due 9 days, Stripe confirmed an hour ago: decidePause says "pause". */
const toPause = (id: string, updatedAt: string) =>
  row(id, { subscriptionStatus: "past_due", pastDueSince: ago(9 * DAY), stripeCheckedAt: ago(HOUR), updatedAt });
/** Paused, and Stripe now says paid: "unpause". */
const toUnpause = (id: string, updatedAt: string) =>
  row(id, { subscriptionStatus: "active", billingPausedAt: ago(3 * DAY), updatedAt });
/** Past the grace, Stripe's word is 2 days old: "unconfirmed". */
const unconfirmed = (id: string) =>
  row(id, { subscriptionStatus: "unpaid", pastDueSince: ago(12 * DAY), stripeCheckedAt: ago(2 * DAY) });
/** Within the grace: "keep". */
const kept = (id: string) =>
  row(id, { subscriptionStatus: "past_due", pastDueSince: ago(2 * DAY), stripeCheckedAt: ago(HOUR) });

const DB = { tag: "service-db" };
const ctx = (): PassContext => ({
  db: DB as never, now: TICK, origin: "https://app.example.com",
  email: { isFake: true, send: vi.fn() }, sms: vi.fn(), closures: NO_CLOSURES,
});
const ZERO = { paused: 0, unpaused: 0, raced: 0, unconfirmed: 0, failed: 0, wouldPause: 0, wouldUnpause: 0 };

let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listPauseCandidates.mockResolvedValue([]);
  dbMocks.pauseBilling.mockResolvedValue("paused");
  dbMocks.clearBillingPause.mockResolvedValue("cleared");
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  log.mockRestore();
  err.mockRestore();
});

describe("billingPausePass", () => {
  it("is keyed billingPause and reports every counter at zero on an empty candidate list", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    expect(billingPausePass.key).toBe("billingPause");
    expect(await billingPausePass.run(ctx())).toEqual(ZERO);
    expect(dbMocks.listPauseCandidates).toHaveBeenCalledWith(DB);
  });

  it("15. switch off: counts wouldPause, wouldUnpause and unconfirmed, writes NOTHING (mutation: write regardless of the switch → FAILS)", async () => {
    for (const off of ["", "true", "0"]) {
      vi.stubEnv("BILLING_ENFORCE", off);
      dbMocks.listPauseCandidates.mockResolvedValue([
        toPause("a", "2026-10-20T00:00:00.1+00:00"), toUnpause("bb", "2026-10-21T00:00:00.2+00:00"),
        unconfirmed("ccc"), kept("dddd"),
      ]);
      expect(await billingPausePass.run(ctx()), off).toEqual({ ...ZERO, wouldPause: 1, wouldUnpause: 1, unconfirmed: 1 });
    }
    expect(dbMocks.pauseBilling).not.toHaveBeenCalled();
    expect(dbMocks.clearBillingPause).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("would pause account a");
  });

  it("16. switch on: pauses each 'pause' row with its own stored updated_at, and heals a paid pause without a lift (mutation: pass ctx.now as the expected version → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    const v1 = "2026-10-20T03:04:05.123456+00:00";
    const v2 = "2026-10-22T06:07:08.654321+00:00";
    const v3 = "2026-10-23T09:10:11.111111+00:00";
    dbMocks.listPauseCandidates.mockResolvedValue([toPause("a", v1), kept("k"), toPause("b", v2), toUnpause("c", v3)]);

    expect(await billingPausePass.run(ctx())).toEqual({ ...ZERO, paused: 2, unpaused: 1 });
    expect(dbMocks.pauseBilling.mock.calls).toEqual([
      [DB, { accountId: "a", expectedUpdatedAt: v1, now: TICK }],
      [DB, { accountId: "b", expectedUpdatedAt: v2, now: TICK }],
    ]);
    expect(dbMocks.clearBillingPause.mock.calls).toEqual([
      [DB, { accountId: "c", expectedUpdatedAt: v3, now: TICK, lift: false }],
    ]);
  });

  it("17. a conflict is counted `raced`, never retried in the tick (mutation: loop on conflict → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.listPauseCandidates.mockResolvedValue([toPause("a", "2026-10-20T00:00:00+00:00"), toUnpause("b", "2026-10-21T00:00:00+00:00")]);
    // A retry would get "paused"/"cleared" on its second call and count it.
    dbMocks.pauseBilling.mockResolvedValueOnce("conflict").mockResolvedValue("paused");
    dbMocks.clearBillingPause.mockResolvedValueOnce("conflict").mockResolvedValue("cleared");

    expect(await billingPausePass.run(ctx())).toEqual({ ...ZERO, raced: 2 });
    expect(dbMocks.pauseBilling).toHaveBeenCalledTimes(1);
    expect(dbMocks.clearBillingPause).toHaveBeenCalledTimes(1);
  });

  it("18. unconfirmed rows are counted and logged with console.log, never console.error, and not paused (mutation: pause unconfirmed → FAILS; mutation: console.error → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.listPauseCandidates.mockResolvedValue([unconfirmed("acct_u")]);

    expect(await billingPausePass.run(ctx())).toEqual({ ...ZERO, unconfirmed: 1 });
    expect(dbMocks.pauseBilling).not.toHaveBeenCalled();
    expect(dbMocks.clearBillingPause).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toMatch(/acct_u.*not paused this tick/);
  });

  it("19. one row's write throwing is counted `failed` and the next row still runs (mutation: let it propagate → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.listPauseCandidates.mockResolvedValue([toPause("a", "2026-10-20T00:00:00+00:00"), toPause("b", "2026-10-21T00:00:00+00:00")]);
    dbMocks.pauseBilling.mockRejectedValueOnce(new Error("pauseBilling failed: boom")).mockResolvedValue("paused");

    expect(await billingPausePass.run(ctx())).toEqual({ ...ZERO, failed: 1, paused: 1 });
    expect(dbMocks.pauseBilling).toHaveBeenCalledTimes(2);
    expect(err.mock.calls.flat().join("\n")).toMatch(/pause failed for account a: Error: pauseBilling failed: boom/);
  });

  it("a candidate read that throws propagates to the harness, which isolates it (mutation: swallow it into zero counters → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.listPauseCandidates.mockRejectedValue(new Error("listPauseCandidates failed: down"));
    await expect(billingPausePass.run(ctx())).rejects.toThrow("listPauseCandidates failed: down");
  });
});
