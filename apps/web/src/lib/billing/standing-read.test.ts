import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BillingStanding } from "@bis/db";

/**
 * M7a PR-4, Task 7 (plan G5, G10, G12, G21): the one cached service-role read
 * of an account's billing verdict, for the paused banner, the read-only guard,
 * the concierge page and layout, and the AI summary. Every case names the
 * mutation that turns it red.
 */

const SERVICE = { tag: "service" };
const read = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  serviceDb: () => SERVICE,
  readBillingStanding: (...a: unknown[]) => read.fn(...a),
}));

const { billingVerdictFor, conciergeOpen } = await import("./standing-read");

const A = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;
const PAUSED_AT = new Date(Date.now() - 3 * DAY).toISOString();

function standing(over: Partial<BillingStanding> = {}): BillingStanding {
  return {
    complimentary: false, pausedAt: null, subscriptionStatus: "active",
    features: { voice_receptionist: true, web_concierge: true }, ...over,
  };
}
const LIVE = { account_id: A, concierge_enabled: true, concierge_form_id: "f1", concierge_form_published: true };

beforeEach(() => {
  read.fn.mockReset();
  vi.stubEnv("BILLING_ENFORCE", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("billingVerdictFor (plan G5, G12)", () => {
  it("switch off → nothing paused, without a read (mutation: read regardless → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "");
    read.fn.mockResolvedValue(standing({ pausedAt: PAUSED_AT, subscriptionStatus: "past_due" }));
    expect(await billingVerdictFor(A)).toEqual({
      paused: false, voice: true, concierge: true, forward: true, cause: null, pausedAt: null,
    });
    expect(read.fn).not.toHaveBeenCalled();
  });

  it("a read error → nothing paused, logged with the account (mutation: rethrow → FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    read.fn.mockRejectedValue(new Error("billing: standing read failed: boom"));
    expect(await billingVerdictFor(A)).toEqual({
      paused: false, voice: true, concierge: true, forward: true, cause: null, pausedAt: null,
    });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toContain(`account ${A}`);
  });

  it("a paused past_due row → paused, cause payment, its pausedAt; a paused canceled row → cause ended (mutation: cause from billingPausedAt alone → FAILS)", async () => {
    read.fn.mockResolvedValue(standing({ pausedAt: PAUSED_AT, subscriptionStatus: "past_due" }));
    expect(await billingVerdictFor(A)).toEqual({
      paused: true, voice: false, concierge: false, forward: true, cause: "payment", pausedAt: PAUSED_AT,
    });
    // The read is the service client's, for THIS account (a Staff session's RLS reads no billing row).
    expect(read.fn).toHaveBeenCalledWith(SERVICE, A);

    read.fn.mockResolvedValue(standing({ pausedAt: PAUSED_AT, subscriptionStatus: "canceled" }));
    expect(await billingVerdictFor(A)).toMatchObject({ paused: true, cause: "ended", pausedAt: PAUSED_AT });
  });

  it("an unpaused row has no cause, and an unbilled account (no row) is everything on (mutation: cause 'payment' whenever a row exists → FAILS)", async () => {
    read.fn.mockResolvedValue(standing({ subscriptionStatus: "past_due" }));
    expect(await billingVerdictFor(A)).toEqual({
      paused: false, voice: true, concierge: true, forward: true, cause: null, pausedAt: null,
    });
    read.fn.mockResolvedValue(null);
    expect(await billingVerdictFor(A)).toEqual({
      paused: false, voice: true, concierge: true, forward: true, cause: null, pausedAt: null,
    });
  });
});

describe("conciergeOpen (plan G10)", () => {
  it("is false for a live chat on a paused account and true for a live chat on an unpaused one (mutation: return isConciergeLive alone → FAILS)", async () => {
    read.fn.mockResolvedValue(standing({ pausedAt: PAUSED_AT, subscriptionStatus: "unpaid" }));
    expect(await conciergeOpen(LIVE)).toBe(false);
    read.fn.mockResolvedValue(standing());
    expect(await conciergeOpen(LIVE)).toBe(true);
  });

  it("a plan without the chat closes it too (Q5) (mutation: read only `paused` → FAILS)", async () => {
    read.fn.mockResolvedValue(standing({ features: { voice_receptionist: true, web_concierge: false } }));
    expect(await conciergeOpen(LIVE)).toBe(false);
  });

  it("a chat that is not live stays closed, and its billing is never read (mutation: read the billing first → FAILS)", async () => {
    read.fn.mockResolvedValue(standing());
    expect(await conciergeOpen({ ...LIVE, concierge_form_published: false })).toBe(false);
    expect(await conciergeOpen({ ...LIVE, concierge_enabled: false })).toBe(false);
    expect(read.fn).not.toHaveBeenCalled();
  });
});
