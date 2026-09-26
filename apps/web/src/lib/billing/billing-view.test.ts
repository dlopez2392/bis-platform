import { describe, it, expect } from "vitest";
import type { AccountBilling, BillingLink, Plan } from "@bis/db";
import { m } from "@/lib/messages";
import {
  billingStatusOf, BILLING_STATUS_TREATMENTS, usageLines, includedLine, monthStartInZone, usagePeriodStart, billingCardView,
  type BillingStatus,
} from "./billing-view";

const NOW = new Date("2026-10-15T15:00:00.000Z");
const ZONE = "America/Chicago";
const row = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, billingStartedAt: "2026-09-12T17:00:00+00:00",
  createdAt: "2026-09-12T17:00:00+00:00", updatedAt: "2026-09-12T17:00:00+00:00", ...over,
});
const link = (expiresAt: string): BillingLink => ({
  accountId: "a", planId: "p1", stripeCustomerId: "cus_1", checkoutSessionId: "cs_1",
  checkoutUrl: "https://checkout.stripe.com/c/pay/cs_1", sentTo: "owner@example.com", expiresAt,
  sentAt: "2026-10-15T14:00:00+00:00", updatedAt: "2026-10-15T14:00:00+00:00",
});
const plan = (id: string, over: Partial<Plan> = {}): Plan => ({
  id, agencyId: "ag", name: `Plan ${id}`, monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 0 }, overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1", stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});

describe("billingStatusOf (G13)", () => {
  it("maps every stored state to one of the seven words (mutation: incomplete → active → FAILS; ignore billing_paused_at → FAILS)", () => {
    const cases: [AccountBilling | null, BillingStatus][] = [
      [null, "unbilled"],
      [row(), "active"], [row({ subscriptionStatus: "trialing" }), "active"],
      [row({ subscriptionStatus: "past_due" }), "payment_failed"], [row({ subscriptionStatus: "unpaid" }), "payment_failed"],
      [row({ subscriptionStatus: "incomplete" }), "payment_failed"],
      [row({ subscriptionStatus: "paused" }), "paused"], [row({ billingPausedAt: "2026-10-10T00:00:00Z" }), "paused"],
      [row({ subscriptionStatus: "canceled" }), "canceled"], [row({ subscriptionStatus: "incomplete_expired" }), "canceled"],
      [row({ complimentary: true, stripeSubscriptionId: null, subscriptionStatus: null }), "complimentary"],
    ];
    for (const [billing, want] of cases) {
      expect(billingStatusOf(billing, null, NOW), JSON.stringify(billing && [billing.subscriptionStatus, billing.billingPausedAt])).toBe(want);
    }
  });

  it("'Link sent' only while the link is unexpired, on an unbilled OR canceled account (mutation: ignore expiresAt → an expired link reads 'Link sent', FAILS)", () => {
    expect(billingStatusOf(null, link("2026-10-16T00:00:00Z"), NOW)).toBe("link_sent");
    expect(billingStatusOf(null, link("2026-10-15T14:59:59Z"), NOW)).toBe("unbilled");
    expect(billingStatusOf(row({ subscriptionStatus: "canceled" }), link("2026-10-16T00:00:00Z"), NOW)).toBe("link_sent");
  });

  it("every treatment is a dot AND a word, in token classes only: no raw palette colour can slip in (PR-1 carried F1) (mutation: write bg-red-500 for payment_failed → FAILS; drop a label → FAILS)", () => {
    const TOKEN = /^(bg|border|text)-(success|destructive|warning|muted-foreground|border|foreground|transparent)(\/\d{1,2})?$/;
    const labels = new Set<string>();
    for (const [status, t] of Object.entries(BILLING_STATUS_TREATMENTS)) {
      expect(t.label, status).toBe(m[`billing.status.${status as BillingStatus}`]);
      labels.add(t.label);
      for (const cls of `${t.dot} ${t.chip}`.split(/\s+/)) expect(cls, `${status}: ${cls}`).toMatch(TOKEN);
    }
    expect(labels.size).toBe(7);
  });
});

describe("usage", () => {
  it("reads '312 of 500 minutes', flags use over the allowance, and says 'none included' instead of 'of 0'; the plan's included line leaves a zero allowance OUT instead of saying '0 minutes of calls' (mutation: swap used and included → FAILS; list every meter in the included line → FAILS)", () => {
    const lines = usageLines({ voice_minutes: 500, sms: 1000, ai_chats: 0 }, { voice_minutes: 312, sms: 1200, ai_chats: 4 });
    expect(lines.map((l) => [l.meter, l.text, l.over])).toEqual([
      ["voice_minutes", "312 of 500 minutes", false],
      ["sms", "1,200 of 1,000 texts", true],
      ["ai_chats", "4 website chats (none included)", true],
    ]);
    expect(includedLine({ voice_minutes: 500, sms: 1000, ai_chats: 200 }))
      .toBe("It includes 500 minutes of calls, 1,000 texts and 200 website chats each month.");
    expect(includedLine({ voice_minutes: 0, sms: 1000, ai_chats: 200 })).toBe("It includes 1,000 texts and 200 website chats each month.");
    expect(includedLine({ voice_minutes: 0, sms: 0, ai_chats: 0 })).toBe(m["billing.includes.none"]);
  });

  it("monthStartInZone is local midnight on the 1st, in the account's zone: Chicago's October starts 05:00 UTC, and 03:00 UTC on Oct 1 is still September there (mutation: use the UTC month → FAILS)", () => {
    expect(monthStartInZone(NOW, ZONE).toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(monthStartInZone(new Date("2026-10-01T03:00:00Z"), ZONE).toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });

  it("a live subscription counts from Stripe's period start; complimentary and canceled accounts from the calendar month (G12) (mutation: always use the calendar month → a subscriber's allowance resets on the 1st, FAILS)", () => {
    expect(usagePeriodStart(row(), ZONE, NOW)).toEqual({ start: new Date("2026-10-12T17:00:00Z"), kind: "billing_period" });
    expect(usagePeriodStart(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }), ZONE, NOW).kind).toBe("calendar_month");
    expect(usagePeriodStart(row({ subscriptionStatus: "canceled" }), ZONE, NOW).kind).toBe("calendar_month");
  });
});

describe("billingCardView", () => {
  const view = (billing: AccountBilling | null, l: BillingLink | null, over: Partial<Parameters<typeof billingCardView>[0]> = {}) =>
    billingCardView({
      billing, link: l, plan: billing ? plan("p1") : null, activePlans: [plan("p1"), plan("p2")],
      used: { voice_minutes: 312, sms: 0, ai_chats: 0 }, zone: ZONE, now: NOW, defaultEmail: "owner@example.com",
      stripeReady: true, ...over,
    });

  it("offers exactly the actions each status allows (G16, G15): Send only when not subscribed, Mark complimentary only when unbilled, Stop only when complimentary, Change plan only on a plan with another plan to go to, and never on an incomplete first payment (mutation: offer Mark complimentary on a canceled row → 0051's CHECK would refuse it, FAILS; offer Change plan on incomplete → FAILS)", () => {
    const can = (b: AccountBilling | null, l: BillingLink | null = null) => view(b, l).can;
    expect(can(null)).toEqual({ send: true, changePlan: false, markComplimentary: true, stopComplimentary: false, copyLink: false });
    expect(can(null, link("2026-10-16T00:00:00Z"))).toEqual({ send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true });
    expect(can(row())).toEqual({ send: false, changePlan: true, markComplimentary: false, stopComplimentary: false, copyLink: false });
    expect(can(row({ subscriptionStatus: "canceled" }))).toEqual({ send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: false });
    expect(can(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }))).toEqual({ send: true, changePlan: true, markComplimentary: false, stopComplimentary: true, copyLink: false });
    expect(can(row({ subscriptionStatus: "incomplete" })).changePlan).toBe(false);
  });

  it("without a usable Stripe key nothing that calls Stripe is offered, but complimentary changes still are (mutation: ignore stripeReady → FAILS)", () => {
    expect(view(null, null, { stripeReady: false }).can).toMatchObject({ send: false, markComplimentary: true });
    expect(view(row(), null, { stripeReady: false }).can.changePlan).toBe(false);
  });

  it("shows the next invoice only for a live subscription, the period it counts from, and the link's recipient and expiry in the account's zone (mutation: show a canceled subscription's old period end as its next invoice → FAILS)", () => {
    const live = view(row(), null);
    expect([live.nextInvoice, live.since]).toEqual([
      m["billing.nextInvoice"].replace("{date}", "Nov 12"), m["billing.usage.since"].replace("{date}", "Oct 12"),
    ]);
    expect(view(row({ subscriptionStatus: "canceled" }), null).nextInvoice).toBeNull();
    expect(view(null, link("2026-10-16T20:30:00Z")).link).toEqual({
      sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/c/pay/cs_1",
    });
  });
});
