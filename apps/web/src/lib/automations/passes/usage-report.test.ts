import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listBilledUsageAccounts: vi.fn(), listReportableUsage: vi.fn(), markUsageReported: vi.fn(),
  countExpiredUsage: vi.fn(), staleUsageAccountIds: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const gatewayMocks = vi.hoisted(() => ({ fromEnv: vi.fn() }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  billingGatewayFromEnv: () => gatewayMocks.fromEnv(),
}));

import type { BilledUsageAccount, UsageRow } from "@bis/db";
import { FakeGateway } from "@/lib/billing/fake-gateway";
import { USAGE_REPORT_BUDGET_MS, USAGE_REPORT_TICK_CAP, METER_EVENT_WORST_CASE_MS } from "../caps";
import type { PassContext } from "../context";
import { usageReportPass } from "./usage-report";

const TICK = new Date("2026-09-25T15:00:00.000Z");
const A: BilledUsageAccount = { accountId: "acct_a", stripeCustomerId: "cus_a", billingStartedAt: "2026-09-20T10:00:00.123456+00:00" };
const B: BilledUsageAccount = { accountId: "acct_b", stripeCustomerId: "cus_b", billingStartedAt: "2026-06-01T00:00:00+00:00" };
const C: BilledUsageAccount = { accountId: "acct_c", stripeCustomerId: "cus_c", billingStartedAt: "2026-09-21T00:00:00+00:00" };

function usage(id: string, over: Partial<UsageRow> = {}): UsageRow {
  return {
    id, accountId: "acct_a", meter: "sms", quantity: 2, occurredAt: "2026-09-25T14:00:00.654321+00:00",
    sourceRef: `message:${id}`, reportedAt: null, createdAt: "2026-09-25T14:00:01+00:00", ...over,
  };
}
const SECS = 1790344800;   // 2026-09-25T14:00:00Z in seconds

const ctx = (): PassContext => ({
  db: {} as never, now: TICK, origin: "https://app.example.com",
  email: { isFake: true, send: vi.fn() }, sms: () => ({ isFake: true, send: vi.fn() }),
  quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
});
const EMPTY = {
  reported: 0, alreadyAtStripe: 0, unstamped: 0, alreadyStamped: 0, failed: 0, expired: 0, staleAccounts: 0,
  skippedNoStripe: 0, stoppedOnCap: 0, stoppedOnError: 0, stoppedOnBudget: 0,
};
const stripeError = (type: string) => Object.assign(new Error(type), { type });

let fake: FakeGateway;
/**
 * The unreported rows the fake database holds, OLDEST FIRST. The read mock
 * does what the real read does that the pass relies on (only the accounts
 * asked for, oldest first, at most `limit`), and a stamp removes its row,
 * as the real read's `reported_at is null` would.
 */
let queue: UsageRow[];

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  fake = new FakeGateway();
  queue = [];
  gatewayMocks.fromEnv.mockReset().mockReturnValue({ ok: true, gateway: fake });
  dbMocks.listBilledUsageAccounts.mockResolvedValue([]);
  dbMocks.listReportableUsage.mockImplementation(async (_db: unknown, accts: BilledUsageAccount[], _now: Date, limit: number) =>
    queue.filter((r) => accts.some((a) => a.accountId === r.accountId)).slice(0, limit));
  dbMocks.markUsageReported.mockImplementation(async (_db: unknown, id: string) => {
    const i = queue.findIndex((r) => r.id === id);
    if (i === -1) return false;
    queue.splice(i, 1);
    return true;
  });
  dbMocks.countExpiredUsage.mockResolvedValue(0);
  dbMocks.staleUsageAccountIds.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); });

describe("usageReportPass", () => {
  it("reports under the key usageReport; with no billed account it returns idle counters and never builds Stripe (mutation: build the gateway before listing accounts → FAILS)", async () => {
    expect(usageReportPass.key).toBe("usageReport");
    expect(await usageReportPass.run(ctx())).toEqual(EMPTY);
    expect(gatewayMocks.fromEnv).not.toHaveBeenCalled();
    expect(dbMocks.staleUsageAccountIds).not.toHaveBeenCalled();
    expect(dbMocks.countExpiredUsage).not.toHaveBeenCalled();
  });

  it("sends each row as one meter event: the meter's permanent event name, the account's customer, the quantity, the row id as identifier, occurred_at in SECONDS, under bis-usage-<row>-<customer> (mutation: timestamp in ms → refused by the guard, FAILS; random identifier → FAILS; key without the customer → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2", { meter: "voice_minutes", quantity: 3 }), usage("u3", { meter: "ai_chats", quantity: 1 })];
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 3 });
    expect(fake.meterEvents).toEqual([
      { eventName: "bis_sms_segments", customerId: "cus_a", value: 2, identifier: "u1", timestampSeconds: SECS },
      { eventName: "bis_voice_minutes", customerId: "cus_a", value: 3, identifier: "u2", timestampSeconds: SECS },
      { eventName: "bis_ai_chats", customerId: "cus_a", value: 1, identifier: "u3", timestampSeconds: SECS },
    ]);
    expect(fake.calls.filter((c) => c.op === "reportMeterEvent").map((c) => c.key))
      .toEqual(["bis-usage-u1-cus_a", "bis-usage-u2-cus_a", "bis-usage-u3-cus_a"]);
  });

  it("stamps reported_at with the tick's now, only AFTER Stripe accepted (mutation: stamp before the send → call order FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    const send = vi.spyOn(fake, "reportMeterEvent");
    await usageReportPass.run(ctx());
    expect(dbMocks.markUsageReported).toHaveBeenCalledWith(expect.anything(), "u1", TICK);
    expect(send.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.markUsageReported.mock.invocationCallOrder[0]!);
  });

  it("reads the rows of EVERY billed account in ONE call asking for the whole cap, and sends them oldest first ACROSS accounts (mutation: a read per account in list order → acct_a's newer row goes first, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    queue = [usage("b1", { accountId: "acct_b", occurredAt: "2026-09-25T13:00:00+00:00" }), usage("a1")];
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 2 });
    expect(dbMocks.listReportableUsage.mock.calls).toEqual([[expect.anything(), [A, B], TICK, USAGE_REPORT_TICK_CAP]]);
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["b1", "a1"]);
  });

  it("counts rows too old for Stripe as expired with ONE call over every billed account, logs them, never sends them (mutation: skip the expired count → FAILS; one count per account → called twice, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    dbMocks.countExpiredUsage.mockResolvedValue(4);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, expired: 4 });
    expect(dbMocks.countExpiredUsage.mock.calls).toEqual([[expect.anything(), [A, B], TICK]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("older than Stripe accepts"));
  });

  it("runs the stale and expired bookkeeping AFTER the sends, so a stale backlog read never spends the send budget (mutation: run the bookkeeping before the send loop → call order FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2")];
    const send = vi.spyOn(fake, "reportMeterEvent");
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 2 });
    const lastSend = send.mock.invocationCallOrder.at(-1)!;
    expect(dbMocks.staleUsageAccountIds.mock.invocationCallOrder[0]!).toBeGreaterThan(lastSend);
    expect(dbMocks.countExpiredUsage.mock.invocationCallOrder[0]!).toBeGreaterThan(lastSend);
  });

  it("counts and logs the billed accounts with usage unreported for over a day, with ONE call over every billed account (mutation: drop the stale log → FAILS; one read per account → called twice, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    dbMocks.staleUsageAccountIds.mockResolvedValue(["acct_a"]);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, staleAccounts: 1 });
    expect(dbMocks.staleUsageAccountIds.mock.calls).toEqual([[expect.anything(), [A, B], TICK]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unreported for over 24 hours on 1 billed account(s): acct_a"));
  });

  it("sends at most USAGE_REPORT_TICK_CAP rows a tick and says the cap stopped it (mutation: ask the read for more than the cap leaves → 230 sent, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    queue = [
      ...Array.from({ length: 150 }, (_, i) => usage(`a${i}`)),
      ...Array.from({ length: 80 }, (_, i) => usage(`b${i}`, { accountId: "acct_b" })),
    ];
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 200, stoppedOnCap: 1 });
    expect(fake.meterEvents).toHaveLength(200);
    expect(dbMocks.listReportableUsage).toHaveBeenCalledTimes(1);
  });

  it("an account whose row Stripe refuses as an invalid request waits for the next tick, its refused row is NEVER stamped, and its rows can never fill the cap ahead of anyone else's: the full read is repeated without it (mutation: keep sending the refused account's rows → 200 attempts on acct_a and b1 never goes, FAILS; no second read → b1 starves, FAILS; stamp the refused row in the refusal's catch → a0 among the stamped ids, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    queue = [
      ...Array.from({ length: 200 }, (_, i) => usage(`a${i}`)),
      usage("b1", { accountId: "acct_b", occurredAt: "2026-09-25T14:30:00+00:00" }),
    ];
    const send = vi.spyOn(fake, "reportMeterEvent").mockRejectedValueOnce(stripeError("StripeInvalidRequestError"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["b1"]);
    expect(dbMocks.listReportableUsage.mock.calls.map((c) => [(c[1] as BilledUsageAccount[]).map((a) => a.accountId), c[3]]))
      .toEqual([[["acct_a", "acct_b"], 200], [["acct_b"], 199]]);
    // Exactly the row Stripe accepted is stamped: a0, refused, stays
    // unreported, so a later tick sends it again once the refusal is fixed.
    expect(dbMocks.markUsageReported.mock.calls.map((c) => c[1])).toEqual(["b1"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("account acct_a's other rows wait for the next tick"));
  });

  it("a systemic failure (rate limit) stops the tick: counted once, nothing after it attempted (mutation: treat it as row-specific → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, C]);
    queue = [usage("u1"), usage("u2"), usage("u3", { accountId: "acct_c" })];
    const send = vi.spyOn(fake, "reportMeterEvent").mockRejectedValueOnce(stripeError("StripeRateLimitError"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, failed: 1, stoppedOnError: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(fake.meterEvents).toEqual([]);
    expect(dbMocks.markUsageReported).not.toHaveBeenCalled();
    expect(dbMocks.listReportableUsage).toHaveBeenCalledTimes(1);
  });

  it("with no usable Stripe key every billed account is skippedNoStripe and nothing is read or sent, but the stale and expired bookkeeping still runs (mutation: throw instead → the pass errors, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    gatewayMocks.fromEnv.mockReturnValue({ ok: false, reason: "missing" });
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, skippedNoStripe: 2 });
    expect(dbMocks.listReportableUsage).not.toHaveBeenCalled();
    expect(dbMocks.staleUsageAccountIds).toHaveBeenCalledTimes(1);
    expect(dbMocks.countExpiredUsage).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Stripe is not usable here (missing)"));
  });

  it("Stripe accepted but the stamp failed: counted unstamped, and the next tick resends under the SAME identifier and key, which the idempotent replay keeps to ONE event (mutation: a fresh key per attempt → two events, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    dbMocks.markUsageReported.mockRejectedValueOnce(new Error("db down"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, unstamped: 1 });
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1 });
    expect(fake.meterEvents).toHaveLength(1);
    expect(fake.calls.filter((c) => c.op === "reportMeterEvent").map((c) => c.key)).toEqual(["bis-usage-u1-cus_a", "bis-usage-u1-cus_a"]);
  });

  // A11 as observed in Stripe test mode: the same identifier under a NEW
  // idempotency key (the old key expired after a failed stamp, or the
  // customer id changed) is refused "An event already exists with
  // identifier <id>.". The event IS at Stripe, so the row is stamped.
  const seedAtStripe = (row: UsageRow, key: string) => fake.reportMeterEvent({
    eventName: "bis_sms_segments", customerId: "cus_a", value: row.quantity, identifier: row.id,
    timestampSeconds: SECS,
  }, key);

  it("a row Stripe already holds (its identifier refused under a new key) is stamped reported and counted alreadyAtStripe, and the account's next row still goes this tick (mutation: treat the duplicate as a row refusal → u1 unstamped, u2 never sent, failed 1, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2")];
    await seedAtStripe(queue[0]!, "a key that expired");
    const heldBefore = fake.meterEvents.length;
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1, alreadyAtStripe: 1 });
    expect(dbMocks.markUsageReported.mock.calls.map((c) => [c[1], c[2]])).toEqual([["u1", TICK], ["u2", TICK]]);
    expect(fake.meterEvents.slice(heldBefore).map((e) => e.identifier)).toEqual(["u2"]);
    expect(fake.meterEvents.filter((e) => e.identifier === "u1")).toHaveLength(1);
    expect(queue).toEqual([]);
  });

  it("the same refusal for a row a concurrent tick already stamped is alreadyStamped, not alreadyAtStripe (mutation: count every duplicate as alreadyAtStripe → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    await seedAtStripe(queue[0]!, "a key that expired");
    dbMocks.markUsageReported.mockResolvedValueOnce(false);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, alreadyStamped: 1 });
  });

  it("a duplicate whose stamp throws is unstamped, and the next tick's identical refusal stamps it (mutation: count a failed duplicate stamp as alreadyAtStripe → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    await seedAtStripe(queue[0]!, "a key that expired");
    dbMocks.markUsageReported.mockRejectedValueOnce(new Error("db down"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, unstamped: 1 });
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, alreadyAtStripe: 1 });
  });

  it("a refusal naming a DIFFERENT identifier is still a row refusal: the row stays unstamped and its account waits (mutation: stamp on any 'already exists' message → u1 stamped, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2")];
    const other = Object.assign(new Error("An event already exists with identifier someone-else."), { type: "StripeInvalidRequestError" });
    vi.spyOn(fake, "reportMeterEvent").mockRejectedValueOnce(other);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.markUsageReported).not.toHaveBeenCalled();
  });

  it("a stamp that finds the row already stamped (a concurrent tick) is alreadyStamped, never reported (mutation: count every resolved stamp as reported → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    dbMocks.markUsageReported.mockResolvedValueOnce(false);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, alreadyStamped: 1 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("was already marked reported"));
  });

  it("stops STARTING sends once the budget less one send's worst case is spent, so a send that hits that worst case still ends inside the budget (mutation: check against the whole budget → u2 starts at 39 s, 2 sent, FAILS; drop the budget check → 3 sent, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2"), usage("u3")];
    // Date.now() calls the pass makes: `startedAt`, then one check before
    // each row. Row 1's check reads no time passed; row 2's reads exactly
    // the last moment a send may start, so rows 2 and 3 wait for the next tick.
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1, stoppedOnBudget: 1 });
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["u1"]);
  });

  it("pins the cap at 200 rows, the budget at 60 seconds, the worst case at 21 seconds, and so the last send start at 39 seconds (mutation: change any → FAILS)", () => {
    expect(USAGE_REPORT_TICK_CAP).toBe(200);
    expect(USAGE_REPORT_BUDGET_MS).toBe(60_000);
    expect(METER_EVENT_WORST_CASE_MS).toBe(21_000);
    expect(USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS).toBe(39_000);
  });
});
