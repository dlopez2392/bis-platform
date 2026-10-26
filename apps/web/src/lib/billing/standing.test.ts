import { describe, it, expect, vi, afterEach } from "vitest";
import { PAUSE_ALERT_FORWARD_MS, type AccountBilling, type BillingStanding } from "@bis/db";
import { billingEnforced } from "./enforce";
import {
  ALL_ON, PAUSE_FORWARD_MS, PAUSE_GRACE_MS, STRIPE_FRESH_MS,
  billingVerdict, decidePause, pauseCause, voiceBlock,
} from "./standing";

/**
 * M7a PR-4, Task 4 (plan G1, G5, G6, G9, I7). Every case names the mutation
 * that turns it red.
 */

const NOW = new Date("2026-10-26T12:00:00.000Z");
const T = NOW.getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const ago = (ms: number) => iso(T - ms);

/** A billed, unpaused, subscribed row; each case overrides what it is about. */
function row(over: Partial<AccountBilling> = {}): AccountBilling {
  return {
    accountId: "acct_1", planId: "plan_1", complimentary: false,
    stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active",
    currentPeriodStart: ago(10 * DAY), currentPeriodEnd: iso(T + 20 * DAY),
    pastDueSince: null, billingPausedAt: null, pauseLiftedAt: null, stripeCheckedAt: null,
    billingStartedAt: ago(90 * DAY), createdAt: ago(90 * DAY), updatedAt: ago(HOUR),
    ...over,
  };
}

/** past_due for `sinceAgo`, Stripe's word `checkedAgo` ago. */
const pastDue = (sinceAgo: number, checkedAgo: number | null, over: Partial<AccountBilling> = {}) =>
  row({
    subscriptionStatus: "past_due", pastDueSince: ago(sinceAgo),
    stripeCheckedAt: checkedAgo === null ? null : ago(checkedAgo), ...over,
  });

function standing(over: Partial<BillingStanding> = {}): BillingStanding {
  return {
    complimentary: false, pausedAt: null, subscriptionStatus: "active",
    features: { voice_receptionist: true, web_concierge: true }, ...over,
  };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("billingEnforced: the switch", () => {
  const env = (vars: Record<string, string>) => ({ NODE_ENV: "test", ...vars }) as NodeJS.ProcessEnv;

  it("1. is on for exactly '1' and nothing else (mutation: accept 'true' → FAILS)", () => {
    expect(billingEnforced(env({ BILLING_ENFORCE: "1" }))).toBe(true);
    for (const v of ["true", "TRUE", " 1", "1 ", "01", "0", "", "yes", "on"]) {
      expect(billingEnforced(env({ BILLING_ENFORCE: v })), v).toBe(false);
    }
    expect(billingEnforced(env({}))).toBe(false);
  });

  it("reads process.env when given nothing (mutation: default to {} → FAILS)", () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    expect(billingEnforced()).toBe(true);
    vi.stubEnv("BILLING_ENFORCE", "true");
    expect(billingEnforced()).toBe(false);
  });
});

describe("decidePause: past_due and unpaid (G1, G6, Q4)", () => {
  it("2. past_due for exactly 7 days, confirmed by Stripe after day 7 and within 26 h, never lifted → pause (mutation: `>` instead of `>=` on the grace → FAILS at exactly 7 days)", () => {
    // The only instant at which Stripe can have confirmed AFTER exactly 7 days is now.
    expect(decidePause(pastDue(PAUSE_GRACE_MS, 0), NOW)).toBe("pause");
    expect(decidePause(pastDue(8 * DAY, 12 * HOUR, { subscriptionStatus: "unpaid" }), NOW)).toBe("pause");
  });

  it("3. 6 days 23 hours → keep (mutation: grace of 6 days → FAILS)", () => {
    expect(decidePause(pastDue(6 * DAY + 23 * HOUR, 0), NOW)).toBe("keep");
  });

  it("4. I1: Stripe confirmed on day 6 (before the grace ended), 20 h ago → unconfirmed, not pause (mutation: drop `checked − since ≥ grace` → FAILS)", () => {
    // past_due 7 d 10 h ago; Stripe last spoke 6 d 14 h into the stretch, 20 h ago.
    const r = pastDue(7 * DAY + 10 * HOUR, 20 * HOUR);
    expect(Date.parse(r.stripeCheckedAt!) - Date.parse(r.pastDueSince!)).toBeLessThan(PAUSE_GRACE_MS);
    expect(decidePause(r, NOW)).toBe("unconfirmed");
  });

  it("5. confirmed after day 7 but 27 h ago, or never → unconfirmed (mutation: skip the freshness check → FAILS)", () => {
    const stale = pastDue(9 * DAY, 27 * HOUR);
    expect(Date.parse(stale.stripeCheckedAt!) - Date.parse(stale.pastDueSince!)).toBeGreaterThanOrEqual(PAUSE_GRACE_MS);
    expect(decidePause(stale, NOW)).toBe("unconfirmed");
    expect(decidePause(pastDue(9 * DAY, null), NOW)).toBe("unconfirmed");
  });

  it("a confirmation exactly 26 h old is still fresh (mutation: `>=` on the freshness → FAILS)", () => {
    expect(STRIPE_FRESH_MS).toBe(26 * HOUR);
    expect(decidePause(pastDue(9 * DAY, STRIPE_FRESH_MS), NOW)).toBe("pause");
  });

  it("6. lifted after past_due_since → keep; lifted BEFORE it (an earlier stretch) → pause (mutation: compare with billing_paused_at → FAILS)", () => {
    expect(decidePause(pastDue(8 * DAY, HOUR, { pauseLiftedAt: ago(2 * DAY) }), NOW)).toBe("keep");
    expect(decidePause(pastDue(8 * DAY, HOUR, { pauseLiftedAt: ago(8 * DAY) }), NOW)).toBe("keep");   // the same instant counts as lifted
    expect(decidePause(pastDue(8 * DAY, HOUR, { pauseLiftedAt: ago(40 * DAY) }), NOW)).toBe("pause");
  });

  it("an unreadable past_due_since never pauses (mutation: drop the NaN guard in `at` → FAILS)", () => {
    expect(decidePause(pastDue(9 * DAY, HOUR, { pastDueSince: "not a date" }), NOW)).toBe("keep");
  });
});

describe("decidePause: an ended plan (spec flow 6)", () => {
  const canceled = (over: Partial<AccountBilling> = {}) => row({ subscriptionStatus: "canceled", ...over });

  it("7. canceled with period end passed → pause; period end tomorrow → keep; null end → pause (mutation: `<` instead of `<=` → FAILS at the exact end)", () => {
    expect(decidePause(canceled({ currentPeriodEnd: ago(DAY) }), NOW)).toBe("pause");
    expect(decidePause(canceled({ currentPeriodEnd: iso(T + DAY) }), NOW)).toBe("keep");
    expect(decidePause(canceled({ currentPeriodEnd: null }), NOW)).toBe("pause");
    expect(decidePause(canceled({ currentPeriodEnd: iso(T) }), NOW)).toBe("pause");
  });

  it("8. canceled and lifted after its end → keep; lifted before its end → pause (mutation: ignore lifts on ended plans → FAILS)", () => {
    expect(decidePause(canceled({ currentPeriodEnd: ago(3 * DAY), pauseLiftedAt: ago(DAY) }), NOW)).toBe("keep");
    expect(decidePause(canceled({ currentPeriodEnd: ago(3 * DAY), pauseLiftedAt: ago(10 * DAY) }), NOW)).toBe("pause");
    expect(decidePause(canceled({ currentPeriodEnd: null, pauseLiftedAt: ago(DAY) }), NOW)).toBe("keep");
  });
});

describe("decidePause: an existing pause, and everything else", () => {
  it("9. paused and now active or trialing → unpause; paused and past_due, unpaid or canceled → keep (mutation: unpause on any non-null status → FAILS)", () => {
    const paused = { billingPausedAt: ago(2 * DAY) };
    expect(decidePause(row({ ...paused, subscriptionStatus: "active" }), NOW)).toBe("unpause");
    expect(decidePause(row({ ...paused, subscriptionStatus: "trialing" }), NOW)).toBe("unpause");
    expect(decidePause(pastDue(10 * DAY, HOUR, paused), NOW)).toBe("keep");
    expect(decidePause(pastDue(10 * DAY, HOUR, { ...paused, subscriptionStatus: "unpaid" }), NOW)).toBe("keep");
    expect(decidePause(row({ ...paused, subscriptionStatus: "canceled", currentPeriodEnd: ago(5 * DAY) }), NOW)).toBe("keep");
  });

  it("10. incomplete, incomplete_expired, Stripe's paused, active → keep; complimentary or no subscription → keep (mutation: treat incomplete_expired as ended → FAILS)", () => {
    // Each carries an ended period and an old past_due stamp Stripe confirmed, so any
    // status mistaken for "ended" or "unpaid" would pause.
    const loaded = { currentPeriodEnd: ago(5 * DAY), pastDueSince: ago(10 * DAY), stripeCheckedAt: ago(HOUR) };
    for (const s of ["incomplete", "incomplete_expired", "paused", "active", "trialing"] as const) {
      expect(decidePause(row({ ...loaded, subscriptionStatus: s }), NOW), s).toBe("keep");
    }
    expect(decidePause(pastDue(10 * DAY, HOUR, { complimentary: true }), NOW)).toBe("keep");
    expect(decidePause(pastDue(10 * DAY, HOUR, { stripeSubscriptionId: null }), NOW)).toBe("keep");
    expect(decidePause(row({ ...loaded, subscriptionStatus: null }), NOW)).toBe("keep");
  });
});

describe("pauseCause", () => {
  it("an ended plan is 'ended', anything else is 'payment' (mutation: map past_due to ended → FAILS)", () => {
    expect(pauseCause({ subscriptionStatus: "canceled" })).toBe("ended");
    expect(pauseCause({ subscriptionStatus: "past_due" })).toBe("payment");
    expect(pauseCause({ subscriptionStatus: "unpaid" })).toBe("payment");
    expect(pauseCause({ subscriptionStatus: null })).toBe("payment");
  });
});

describe("billingVerdict (G5, I7)", () => {
  const pausedNoFeatures = standing({
    pausedAt: ago(40 * DAY), subscriptionStatus: "past_due",
    features: { voice_receptionist: false, web_concierge: false },
  });

  it("11a. switch off → ALL_ON whatever the row (mutation: drop the enforced check → FAILS)", () => {
    expect(billingVerdict(pausedNoFeatures, false, NOW)).toEqual(ALL_ON);
  });

  it("11b. no row → ALL_ON (mutation: pause a null standing → FAILS)", () => {
    expect(billingVerdict(null, true, NOW)).toEqual(ALL_ON);
    expect(ALL_ON).toEqual({ paused: false, voice: true, concierge: true, forward: true });
    expect(Object.isFrozen(ALL_ON)).toBe(true);
  });

  it("11c. paused → voice and concierge off, even on a plan with both (mutation: keep concierge on → FAILS)", () => {
    expect(billingVerdict(standing({ pausedAt: ago(DAY), subscriptionStatus: "past_due" }), true, NOW))
      .toEqual({ paused: true, voice: false, concierge: false, forward: true });
  });

  it("11d. plan without voice → voice off, forward on, concierge per plan (mutation: forward off for plan-no-voice → FAILS)", () => {
    expect(billingVerdict(standing({ features: { voice_receptionist: false, web_concierge: true } }), true, NOW))
      .toEqual({ paused: false, voice: false, concierge: true, forward: true });
    expect(billingVerdict(standing({ features: { voice_receptionist: false, web_concierge: false } }), true, NOW))
      .toEqual({ paused: false, voice: false, concierge: false, forward: true });
    expect(billingVerdict(standing({ features: { voice_receptionist: true, web_concierge: false } }), true, NOW))
      .toEqual({ paused: false, voice: true, concierge: false, forward: true });
  });

  it("11e. complimentary follows its plan (mutation: ALL_ON for complimentary → FAILS)", () => {
    expect(billingVerdict(standing({ complimentary: true, subscriptionStatus: null, features: { voice_receptionist: false, web_concierge: false } }), true, NOW))
      .toEqual({ paused: false, voice: false, concierge: false, forward: true });
  });

  it("12. I7: paused 29 days 23 h → forward; paused exactly 30 days → no forward (mutation: `<=` → FAILS at exactly 30 days)", () => {
    expect(billingVerdict(standing({ pausedAt: ago(29 * DAY + 23 * HOUR) }), true, NOW).forward).toBe(true);
    expect(billingVerdict(standing({ pausedAt: ago(PAUSE_FORWARD_MS) }), true, NOW).forward).toBe(false);
    expect(billingVerdict(standing({ pausedAt: ago(PAUSE_FORWARD_MS) }), true, NOW).paused).toBe(true);
  });
});

describe("voiceBlock (G9)", () => {
  it("13. prefers billing-paused over plan-no-voice, carrying forward; plan-no-voice always forwards (mutation: swap the order → FAILS; mutation: plan-no-voice forward false → FAILS)", () => {
    // A paused verdict always has voice off, so the order is what decides the reason.
    expect(voiceBlock({ paused: true, voice: false, concierge: false, forward: true })).toEqual({ reason: "billing-paused", forward: true });
    expect(voiceBlock({ paused: true, voice: false, concierge: false, forward: false })).toEqual({ reason: "billing-paused", forward: false });
    expect(voiceBlock({ paused: false, voice: false, concierge: true, forward: true })).toEqual({ reason: "plan-no-voice", forward: true });
    expect(voiceBlock(ALL_ON)).toBeNull();
  });
});

describe("constants", () => {
  it("14. PAUSE_FORWARD_MS equals @bis/db's PAUSE_ALERT_FORWARD_MS (mutation: change one → FAILS)", () => {
    expect(PAUSE_FORWARD_MS).toBe(PAUSE_ALERT_FORWARD_MS);
    expect(PAUSE_FORWARD_MS).toBe(30 * DAY);
    expect(PAUSE_GRACE_MS).toBe(7 * DAY);
  });
});
