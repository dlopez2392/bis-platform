import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  listPauseCandidates: vi.fn(), mirrorSubscription: vi.fn(), listReconcilableAccounts: vi.fn(),
  reconciledSince: vi.fn(), latestReconciliations: vi.fn(), readUsageBands: vi.fn(),
  saveReconciliation: vi.fn(), markUsageReported: vi.fn(), healPermissions: vi.fn(),
}));
// Spread-real: the constants (METER_KEYS, PAST_DUE_STATUSES, ALERTING_VERDICTS)
// and the shared reconcileNightStart stay the real ones.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import type { AccountBilling, Reconciliation, SubscriptionSnapshot, UsageBands, UsageRow } from "@bis/db";
import { USAGE_REPORT_BUDGET_MS, METER_EVENT_WORST_CASE_MS } from "@/lib/automations/caps";
import type { PassContext } from "@/lib/automations/context";
import { NO_CLOSURES } from "@/lib/automations/closures";
import { FakeGateway } from "./fake-gateway";
import { usageIdempotencyKey } from "./stripe-gateway";
import { runBillingNightly, type NightlyCounters } from "./nightly";

const NOW = new Date("2026-10-26T09:30:00.000Z");
const RUN_START = "2026-10-26T08:00:00.000Z";          // reconcileNightStart(NOW)
const PERIOD_START = "2026-10-20T00:00:00+00:00";
const CURRENT_START_MS = Date.parse("2026-10-20T00:00:00.000Z");
const ZERO: NightlyCounters = {
  remirrored: 0, reconciled: 0, mismatched: 0, heldStamped: 0, heldSent: 0, reconcileFailed: 0, reconcileSkippedBudget: 0,
};
const NO_BANDS: UsageBands = { settled: 0, inFlight: 0, held: 0, heldRows: [] };

function bill(over: Partial<AccountBilling> = {}): AccountBilling {
  return {
    accountId: "acct_a", planId: "plan_1", complimentary: false, stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_a",
    subscriptionStatus: "active", currentPeriodStart: PERIOD_START, currentPeriodEnd: "2026-11-20T00:00:00+00:00",
    pastDueSince: null, billingPausedAt: null, pauseLiftedAt: null, stripeCheckedAt: null,
    billingStartedAt: "2026-09-20T00:00:00+00:00", createdAt: "2026-09-20T00:00:00+00:00", updatedAt: "2026-10-20T00:00:00+00:00",
    ...over,
  };
}
function held(id: string, quantity: number): UsageRow {
  return {
    id, accountId: "acct_a", meter: "sms", quantity, occurredAt: "2026-10-24T12:00:00.654321+00:00",
    sourceRef: `message:${id}`, reportedAt: null, createdAt: "2026-10-24T12:00:01+00:00",
  };
}
const ctx = (): PassContext => ({
  db: {} as never, now: NOW, origin: "https://app.example.com",
  email: { isFake: true, send: vi.fn() }, sms: vi.fn(), closures: NO_CLOSURES,
});
const clockAt = (elapsedMs: number) => ({ startedAt: 0, nowMs: () => elapsedMs });
/** Sets the sms meter's bands for the CURRENT window; the other meters read empty. */
const smsBands = (bands: UsageBands, closed?: UsageBands) =>
  db.readUsageBands.mockImplementation(async (_db: unknown, input: { meter: string; startIso: string }) => {
    if (input.meter !== "sms") return NO_BANDS;
    if (Date.parse(input.startIso) === CURRENT_START_MS) return bands;
    return closed ?? NO_BANDS;
  });
const savedFor = (meter: string) =>
  db.saveReconciliation.mock.calls.map((c) => c[1] as Reconciliation).filter((r) => r.meter === meter);

let fake: FakeGateway;
let errors: { mock: { calls: unknown[][] } };

beforeEach(() => {
  vi.stubEnv("BILLING_ENFORCE", "1");
  for (const fn of Object.values(db)) fn.mockReset();
  fake = new FakeGateway();
  fake.meters = [
    { id: "mtr_voice", eventName: "bis_voice_minutes" }, { id: "mtr_sms", eventName: "bis_sms_segments" },
    { id: "mtr_chat", eventName: "bis_ai_chats" },
  ];
  db.listPauseCandidates.mockResolvedValue([]);
  db.mirrorSubscription.mockImplementation(async (_db: unknown, read: () => Promise<SubscriptionSnapshot>) => {
    // The real mirror reads Stripe twice in the normal case.
    const snap = await read();
    await read();
    return { kind: "written", accountId: snap.accountId, planId: "plan_1", status: snap.status };
  });
  db.listReconcilableAccounts.mockResolvedValue([bill()]);
  db.reconciledSince.mockResolvedValue(new Set());
  db.latestReconciliations.mockResolvedValue(new Map());
  db.readUsageBands.mockResolvedValue(NO_BANDS);
  db.saveReconciliation.mockResolvedValue(undefined);
  db.markUsageReported.mockResolvedValue(true);
  db.healPermissions.mockResolvedValue(undefined);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runBillingNightly", () => {
  it("switch off → nothing runs: no re-mirror, no Stripe call, no write (mutation: drop the switch check → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "true");   // anything but "1" is off
    db.listPauseCandidates.mockResolvedValue([bill({ subscriptionStatus: "past_due", stripeSubscriptionId: "sub_p" })]);
    expect(await runBillingNightly(ctx(), fake, clockAt(0))).toEqual(ZERO);
    for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });

  it("skip-before / due-after: a pair checked after this window's start is skipped; one checked before it is due (mutation: compare with the previous window → FAILS)", async () => {
    db.reconciledSince.mockResolvedValue(new Set([`acct_a:sms:${CURRENT_START_MS}`]));
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(db.reconciledSince).toHaveBeenCalledWith(expect.anything(), RUN_START);
    expect(savedFor("sms")).toEqual([]);
    expect(savedFor("voice_minutes")).toHaveLength(1);
    expect(savedFor("ai_chats")).toHaveLength(1);
    expect(c.reconciled).toBe(2);
    // One minute before 08:00 the window is still yesterday's.
    db.reconciledSince.mockClear();
    await runBillingNightly({ ...ctx(), now: new Date("2026-10-26T07:59:00.000Z") }, fake, clockAt(0));
    expect(db.reconciledSince).toHaveBeenCalledWith(expect.anything(), "2026-10-25T08:00:00.000Z");
  });

  it("re-mirrors every past_due, unpaid and paused subscription not yet re-read this window, once, with bounded transport (mutation: re-mirror active rows too → FAILS by call count; mutation: unbounded read → FAILS: the stub sees no options)", async () => {
    db.listReconcilableAccounts.mockResolvedValue([]);
    db.listPauseCandidates.mockResolvedValue([
      bill({ accountId: "a_p", stripeSubscriptionId: "sub_p", subscriptionStatus: "past_due", stripeCheckedAt: "2026-10-26T07:59:59+00:00" }),
      bill({ accountId: "a_u", stripeSubscriptionId: "sub_u", subscriptionStatus: "unpaid" }),
      bill({ accountId: "a_x", stripeSubscriptionId: "sub_x", subscriptionStatus: "canceled", billingPausedAt: "2026-10-01T00:00:00+00:00" }),
      bill({ accountId: "a_c", stripeSubscriptionId: "sub_c", subscriptionStatus: "canceled" }),           // ended, not paused: no
      bill({ accountId: "a_d", stripeSubscriptionId: "sub_d", subscriptionStatus: "past_due", stripeCheckedAt: "2026-10-26T08:00:00+00:00" }), // read this window
    ]);
    for (const id of ["sub_p", "sub_u", "sub_x", "sub_c", "sub_d"]) {
      fake.subscriptions.set(id, { id, accountId: `a_${id.slice(4)}`, status: "past_due" } as unknown as SubscriptionSnapshot);
    }
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(fake.calls.filter((x) => x.op === "retrieveSubscription").map((x) => (x.input as { subscriptionId: string }).subscriptionId))
      .toEqual(["sub_p", "sub_p", "sub_u", "sub_u", "sub_x", "sub_x"]);
    expect(fake.transport.filter((t) => t.op === "retrieveSubscription").every((t) => t.bounded)).toBe(true);
    expect(db.mirrorSubscription).toHaveBeenCalledTimes(3);
    // The mirror is stamped with the tick's ONE now.
    expect((db.mirrorSubscription.mock.calls[0]![2] as () => Date)()).toBe(NOW);
    expect(c.remirrored).toBe(3);
  });

  it("a refused re-mirror is logged and not counted; a failed one is counted and the next still runs (mutation: rethrow → FAILS)", async () => {
    db.listReconcilableAccounts.mockResolvedValue([]);
    db.listPauseCandidates.mockResolvedValue([
      bill({ accountId: "a_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "unpaid" }),
      bill({ accountId: "a_2", stripeSubscriptionId: "sub_2", subscriptionStatus: "unpaid" }),
      bill({ accountId: "a_3", stripeSubscriptionId: "sub_3", subscriptionStatus: "unpaid" }),
    ]);
    db.mirrorSubscription
      .mockResolvedValueOnce({ kind: "refused", reason: "ended_other_subscription" })
      .mockRejectedValueOnce(new Error("Stripe 500"))
      .mockResolvedValueOnce({ kind: "written", accountId: "a_3", planId: "plan_1", status: "unpaid" });
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(c).toMatchObject({ remirrored: 1, reconcileFailed: 1 });
    expect(errors.mock.calls.map((x) => String(x[0])).join("\n")).toMatch(/sub_1.*refused: ended_other_subscription/);
  });

  it("a re-mirror starts only while elapsed < budget − 2 × worst case; at budget − 1.5 × worst case it stops and counts reconcileSkippedBudget (mutation: one worst case → FAILS)", async () => {
    db.listPauseCandidates.mockResolvedValue([bill({ stripeSubscriptionId: "sub_u", subscriptionStatus: "unpaid" })]);
    fake.subscriptions.set("sub_u", { id: "sub_u", accountId: "acct_a", status: "unpaid" } as unknown as SubscriptionSnapshot);
    const late = await runBillingNightly(ctx(), fake, clockAt(USAGE_REPORT_BUDGET_MS - 1.5 * METER_EVENT_WORST_CASE_MS));
    expect(late).toEqual({ ...ZERO, reconcileSkippedBudget: 1 });
    expect(db.mirrorSubscription).not.toHaveBeenCalled();
    expect(db.listReconcilableAccounts).not.toHaveBeenCalled();
    const inTime = await runBillingNightly(ctx(), fake, clockAt(USAGE_REPORT_BUDGET_MS - 2 * METER_EVENT_WORST_CASE_MS - 1));
    expect(db.mirrorSubscription).toHaveBeenCalledTimes(1);
    expect(inTime.remirrored).toBe(1);
  });

  it("listActiveMeters is called bounded and only while canStart (mutation: call it unconditionally → FAILS when the budget is spent)", async () => {
    await runBillingNightly(ctx(), fake, clockAt(0));
    expect(fake.transport.filter((t) => t.op === "listActiveMeters")).toEqual([{ op: "listActiveMeters", bounded: true }]);
    fake.transport.length = 0;
    const spent = await runBillingNightly(ctx(), fake, clockAt(USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS));
    expect(fake.transport).toEqual([]);
    expect(spent).toEqual({ ...ZERO, reconcileSkippedBudget: 1 });
  });

  it("a failed meter list is counted, logged, and the re-mirror counts survive (mutation: let it throw → FAILS)", async () => {
    db.listPauseCandidates.mockResolvedValue([bill({ stripeSubscriptionId: "sub_u", subscriptionStatus: "unpaid" })]);
    fake.subscriptions.set("sub_u", { id: "sub_u", accountId: "acct_a", status: "unpaid" } as unknown as SubscriptionSnapshot);
    fake.failOn = { op: "listActiveMeters" };
    expect(await runBillingNightly(ctx(), fake, clockAt(0))).toEqual({ ...ZERO, remirrored: 1, reconcileFailed: 1 });
    expect(db.saveReconciliation).not.toHaveBeenCalled();
  });

  it("a Stripe call starts only while elapsed < budget − worst case, on the pass's own clock (mutation: a fresh clock → FAILS: it overruns USAGE_REPORT_BUDGET_MS)", async () => {
    // The report's sends already took 30 s of the pass's budget; the meter
    // list takes 10 s more, so only 20 s are left: under one worst case.
    let elapsed = 30_000;
    const list = fake.listActiveMeters.bind(fake);
    vi.spyOn(fake, "listActiveMeters").mockImplementation(async (o) => { const m = await list(o); elapsed = 40_000; return m; });
    const c = await runBillingNightly(ctx(), fake, { startedAt: 0, nowMs: () => elapsed });
    expect(fake.calls.filter((x) => x.op === "meterTotal")).toEqual([]);
    expect(db.saveReconciliation).not.toHaveBeenCalled();
    expect(c).toEqual({ ...ZERO, reconcileSkippedBudget: 1 });
  });

  it("held_at_stripe stamps exactly the held rows; held_missing sends each with the reporter's key, then stamps (mutation: send without stamping → FAILS)", async () => {
    // Stripe counts settled 4 + held 3 = 7: the held rows are there.
    smsBands({ settled: 4, inFlight: 0, held: 3, heldRows: [held("h1", 1), held("h2", 2)] });
    fake.seedMeterTotal("mtr_sms", "cus_a", 7);
    const at = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(db.markUsageReported.mock.calls.map((c) => [c[1], c[2]])).toEqual([["h1", NOW], ["h2", NOW]]);
    expect(fake.calls.filter((x) => x.op === "reportMeterEvent")).toEqual([]);
    expect(at).toMatchObject({ heldStamped: 2, heldSent: 0, reconciled: 3, mismatched: 0 });
    expect(savedFor("sms")[0]).toMatchObject({ verdict: "held_at_stripe", bisSettled: 4, bisHeld: 3, stripeTotal: 7 });

    // Stripe counts only the settled 4: the held rows are missing, so send them.
    db.markUsageReported.mockClear();
    db.saveReconciliation.mockClear();
    fake = new FakeGateway();
    fake.meters = [{ id: "mtr_voice", eventName: "bis_voice_minutes" }, { id: "mtr_sms", eventName: "bis_sms_segments" }, { id: "mtr_chat", eventName: "bis_ai_chats" }];
    fake.seedMeterTotal("mtr_sms", "cus_a", 4);
    const missing = await runBillingNightly(ctx(), fake, clockAt(0));
    const SECS = Math.floor(Date.parse("2026-10-24T12:00:00.654Z") / 1000);
    expect(fake.calls.filter((x) => x.op === "reportMeterEvent")).toEqual([
      { op: "reportMeterEvent", key: usageIdempotencyKey("h1", "cus_a"), input: { eventName: "bis_sms_segments", customerId: "cus_a", value: 1, identifier: "h1", timestampSeconds: SECS } },
      { op: "reportMeterEvent", key: usageIdempotencyKey("h2", "cus_a"), input: { eventName: "bis_sms_segments", customerId: "cus_a", value: 2, identifier: "h2", timestampSeconds: SECS } },
    ]);
    expect(db.markUsageReported.mock.calls.map((c) => c[1])).toEqual(["h1", "h2"]);
    expect(missing).toMatchObject({ heldStamped: 0, heldSent: 2 });
    expect(savedFor("sms")[0]).toMatchObject({ verdict: "held_missing" });
  });

  it("held_missing: a duplicate refusal stamps the row as heldStamped, never heldSent (mutation: count it sent → FAILS)", async () => {
    smsBands({ settled: 0, inFlight: 0, held: 1, heldRows: [held("h1", 1)] });
    // Stripe holds h1's identifier (sent long ago, outside this window), so
    // the new key is refused as a duplicate.
    await fake.reportMeterEvent({ eventName: "bis_sms_segments", customerId: "cus_a", value: 1, identifier: "h1", timestampSeconds: 60 }, "an-old-key");
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(db.markUsageReported.mock.calls.map((x) => x[1])).toEqual(["h1"]);
    expect(c).toMatchObject({ heldStamped: 1, heldSent: 0, reconcileFailed: 0 });
  });

  it("held_missing: a row refusal leaves the row unstamped and the next held row still runs (mutation: stamp on any failure → FAILS)", async () => {
    smsBands({ settled: 0, inFlight: 0, held: 3, heldRows: [held("h1", 1), held("h2", 2)] });
    const send = fake.reportMeterEvent.bind(fake);
    vi.spyOn(fake, "reportMeterEvent")
      .mockRejectedValueOnce(Object.assign(new Error("Invalid value"), { type: "StripeInvalidRequestError" }))
      .mockImplementation(send);
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(db.markUsageReported.mock.calls.map((x) => x[1])).toEqual(["h2"]);
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["h2"]);
    expect(c).toMatchObject({ heldSent: 1, heldStamped: 0, reconcileFailed: 1 });
  });

  it("I9: on the first window after rollover the closed period is compared once to its end, report-only, before the current one (mutation: send held rows of the closed period → FAILS)", async () => {
    db.latestReconciliations.mockResolvedValue(new Map([["acct_a:sms", {
      accountId: "acct_a", meter: "sms", windowStart: "2026-09-20T00:00:00+00:00", windowEnd: "2026-10-19T08:00:00+00:00",
      bisSettled: 0, bisInFlight: 0, bisHeld: 0, stripeTotal: 0, verdict: "match", checkedAt: "2026-10-19T08:15:00+00:00",
    } satisfies Reconciliation]]));
    // The closed period has held rows Stripe lacks; the current one is empty.
    smsBands(NO_BANDS, { settled: 0, inFlight: 0, held: 3, heldRows: [held("h1", 1), held("h2", 2)] });
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(savedFor("sms").map((r) => [r.windowStart, r.windowEnd, r.verdict])).toEqual([
      ["2026-09-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z", "held_missing"],
      ["2026-10-20T00:00:00.000Z", "2026-10-26T09:30:00.000Z", "match"],
    ]);
    expect(fake.calls.filter((x) => x.op === "reportMeterEvent")).toEqual([]);
    expect(db.markUsageReported).not.toHaveBeenCalled();
    expect(c).toMatchObject({ reconciled: 4, heldSent: 0, heldStamped: 0 });
  });

  it("an alerting verdict is saved and logged with console.error (mutation: save only matches → FAILS)", async () => {
    smsBands({ settled: 10, inFlight: 0, held: 0, heldRows: [] });
    fake.seedMeterTotal("mtr_sms", "cus_a", 4);
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(savedFor("sms")).toEqual([{
      accountId: "acct_a", meter: "sms", windowStart: "2026-10-20T00:00:00.000Z", windowEnd: "2026-10-26T09:30:00.000Z",
      bisSettled: 10, bisInFlight: 0, bisHeld: 0, stripeTotal: 4, verdict: "stripe_under", checkedAt: NOW.toISOString(),
    }]);
    expect(c).toMatchObject({ reconciled: 3, mismatched: 1 });
    expect(errors.mock.calls.map((x) => String(x[0])).join("\n")).toMatch(/sms for account acct_a is stripe_under: Stripe 4, BIS settled 10/);
  });

  it("heals accounts.permissions for every account it reconciled (mutation: skip the heal → FAILS)", async () => {
    db.listReconcilableAccounts.mockResolvedValue([bill(), bill({ accountId: "acct_b", stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_b" })]);
    await runBillingNightly(ctx(), fake, clockAt(0));
    expect(db.healPermissions.mock.calls.map((c) => c[1])).toEqual(["acct_a", "acct_b"]);
  });

  it("one account's Stripe failure is counted and the next account still runs (mutation: rethrow → FAILS)", async () => {
    db.listReconcilableAccounts.mockResolvedValue([bill(), bill({ accountId: "acct_b", stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_b" })]);
    const total = fake.meterTotal.bind(fake);
    vi.spyOn(fake, "meterTotal").mockRejectedValueOnce(new Error("Stripe 500")).mockImplementation(total);
    const c = await runBillingNightly(ctx(), fake, clockAt(0));
    expect(c).toMatchObject({ reconciled: 5, reconcileFailed: 1 });
    expect(db.saveReconciliation.mock.calls.map((x) => (x[1] as Reconciliation).accountId).filter((a) => a === "acct_b")).toHaveLength(3);
  });
});
