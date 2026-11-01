import { describe, it, expect } from "vitest";
import type { AccountBilling, BillingLink, Plan, Reconciliation } from "@bis/db";
import { m } from "@/lib/messages";
import {
  billingStatusOf, BILLING_STATUS_TREATMENTS, usageLines, includedLine, monthStartInZone, usagePeriodStart, billingCardView,
  showsPaymentFailedBanner, formatDay, formatMoment, priceLine, billingStatusTreatment,
  type BillingStatus,
} from "./billing-view";

const NOW = new Date("2026-10-15T15:00:00.000Z");
const ZONE = "America/Chicago";
const row = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, pauseLiftedAt: null, stripeCheckedAt: null, billingStartedAt: "2026-09-12T17:00:00+00:00",
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
const reconciliation = (over: Partial<Reconciliation> = {}): Reconciliation => ({
  accountId: "a", meter: "sms", windowStart: "2026-10-01T00:00:00+00:00", windowEnd: "2026-10-15T00:00:00+00:00",
  bisSettled: 100, bisInFlight: 5, bisHeld: 0, stripeTotal: 100, verdict: "match", checkedAt: "2026-10-15T14:00:00+00:00", ...over,
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

describe("showsPaymentFailedBanner (G21)", () => {
  it("is true only for past_due/unpaid, never incomplete, complimentary or while the verdict is paused (mutation: include incomplete → FAILS; ignore complimentary → FAILS; ignore the verdict → FAILS)", () => {
    const LIVE = { paused: false };
    expect(showsPaymentFailedBanner(null, LIVE)).toBe(false);
    expect(showsPaymentFailedBanner(row({ subscriptionStatus: "past_due" }), LIVE)).toBe(true);
    expect(showsPaymentFailedBanner(row({ subscriptionStatus: "unpaid" }), LIVE)).toBe(true);
    expect(showsPaymentFailedBanner(row({ subscriptionStatus: "incomplete" }), LIVE)).toBe(false);
    expect(showsPaymentFailedBanner(row({ subscriptionStatus: "past_due", complimentary: true }), LIVE)).toBe(false);
    expect(showsPaymentFailedBanner(row({ subscriptionStatus: "past_due" }), { paused: true })).toBe(false);
  });

  it("decides from the VERDICT, not the stored pause stamp: a stamped past-due row with no live pause (switch off, verdict failed open) still shows it (design review I1) (mutation: also require !billingPausedAt → FAILS)", () => {
    const stamped = row({ subscriptionStatus: "past_due", billingPausedAt: "2026-10-10T00:00:00Z" });
    expect(showsPaymentFailedBanner(stamped, { paused: false })).toBe(true);
    expect(showsPaymentFailedBanner(stamped, { paused: true })).toBe(false);
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

  // S-10 T9a: found live as "1 minutes (none included)" / "1 chats (none
  // included)" in BOTH languages — the ".none" branch always read the
  // plain "other" form, regardless of how many were used.
  it("a single used unit stays singular in English and Spanish, not just plural (mutation: drop the One form → FAILS)", () => {
    const en = usageLines({ voice_minutes: 0, sms: 0, ai_chats: 0 }, { voice_minutes: 1, sms: 1, ai_chats: 1 });
    expect(en.map((l) => l.text)).toEqual([
      "1 minute (none included)",
      "1 text (none included)",
      "1 website chat (none included)",
    ]);
    const es = usageLines({ voice_minutes: 0, sms: 0, ai_chats: 0 }, { voice_minutes: 1, sms: 1, ai_chats: 1 }, "es");
    expect(es.map((l) => l.text)).toEqual([
      "1 minuto (ninguno incluido)",
      "1 mensaje de texto (ninguno incluido)",
      "1 chat del sitio web (ninguno incluido)",
    ]);
  });

  it("use exactly at the allowance is not over (mutation: over uses >= → FAILS) (R2)", () => {
    expect(usageLines({ voice_minutes: 500, sms: 1000, ai_chats: 0 }, { voice_minutes: 500, sms: 0, ai_chats: 0 })[0]!.over).toBe(false);
  });

  it("monthStartInZone is local midnight on the 1st, in the account's zone: Chicago's October starts 05:00 UTC, and 03:00 UTC on Oct 1 is still September there (mutation: use the UTC month → FAILS)", () => {
    expect(monthStartInZone(NOW, ZONE).toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(monthStartInZone(new Date("2026-10-01T03:00:00Z"), ZONE).toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });

  it("formatDay reads the date in the account's own zone, not UTC: 02:00 UTC on the 12th is still the 11th in Chicago (mutation: format in UTC → FAILS) (R3)", () => {
    expect(formatDay(new Date("2026-10-12T02:00:00Z"), ZONE)).toBe("Oct 11");
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
      stripeReady: true, webhookReady: true, ...over,
    });

  it("offers exactly the actions each status allows (G16, G15): Send only when not subscribed, Mark complimentary only when unbilled, Stop only when complimentary, Change plan only on a plan with another plan to go to, and never on an incomplete first payment (mutation: offer Mark complimentary on a canceled row → 0051's CHECK would refuse it, FAILS; offer Change plan on incomplete → FAILS)", () => {
    const can = (b: AccountBilling | null, l: BillingLink | null = null) => view(b, l).can;
    expect(can(null)).toEqual({ send: true, changePlan: false, markComplimentary: true, stopComplimentary: false, copyLink: false, liftPause: false });
    expect(can(null, link("2026-10-16T00:00:00Z"))).toEqual({ send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true, liftPause: false });
    expect(can(row())).toEqual({ send: false, changePlan: true, markComplimentary: false, stopComplimentary: false, copyLink: false, liftPause: false });
    expect(can(row({ subscriptionStatus: "canceled" }))).toEqual({ send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: false, liftPause: false });
    expect(can(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }))).toEqual({ send: true, changePlan: true, markComplimentary: false, stopComplimentary: true, copyLink: false, liftPause: false });
    expect(can(row({ subscriptionStatus: "incomplete" })).changePlan).toBe(false);
    // With no OTHER plan to move to, Change plan is never offered, even where
    // the status alone would allow it (mutation: drop otherPlan → FAILS) (R5).
    expect(view(row(), null, { activePlans: [plan("p1")] }).can.changePlan).toBe(false);
    expect(view(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }), null, { activePlans: [plan("p1")] }).can.changePlan).toBe(false);
    // With no plans at all, Send and Mark complimentary have nothing to offer
    // (mutation: drop the plan-count check from send → FAILS) (R6) (mutation:
    // drop the plan-count check from markComplimentary → FAILS) (R7).
    expect(view(null, null, { activePlans: [] }).can).toMatchObject({ send: false, markComplimentary: false });
    // A complimentary row (G1's complimentary→paid) can still hold a LIVE
    // link (Send is offered on complimentary): the status word stays
    // `complimentary`, but the link and Copy link must not disappear, or
    // billing.error.emailFailed's "Use Copy link" has nothing to click (G18)
    // (mutation: gate link/copyLink on status === "link_sent" only → FAILS).
    const compWithLink = view(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }), link("2026-10-16T20:30:00Z"));
    expect(compWithLink.can).toEqual({ send: true, changePlan: true, markComplimentary: false, stopComplimentary: true, copyLink: true, liftPause: false });
    expect(compWithLink.link).toEqual({ sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/c/pay/cs_1" });
  });

  it("without a usable Stripe key nothing that calls Stripe is offered, but complimentary changes still are (mutation: ignore stripeReady → FAILS)", () => {
    expect(view(null, null, { stripeReady: false }).can).toMatchObject({ send: false, markComplimentary: true });
    expect(view(row(), null, { stripeReady: false }).can.changePlan).toBe(false);
  });

  it("without the webhook signing secret Send is not offered (a client who paid would show as Unbilled until an event could land), but paid Change plan and Mark complimentary still are: a live subscription means the webhook already worked, and complimentary never touches Stripe (final review I1) (mutation: ignore webhookReady → FAILS; gate Change plan on it too → FAILS)", () => {
    expect(view(null, null, { webhookReady: false }).can).toMatchObject({ send: false, markComplimentary: true });
    expect(view(row({ subscriptionStatus: "canceled" }), null, { webhookReady: false }).can.send).toBe(false);
    expect(view(row(), null, { webhookReady: false }).can.changePlan).toBe(true);
    expect(view(null, null, { webhookReady: false }).webhookReady).toBe(false);
  });

  it("shows the next invoice only for a live subscription, the period it counts from, and the link's recipient and expiry in the account's zone (mutation: show a canceled subscription's old period end as its next invoice → FAILS)", () => {
    const live = view(row(), null);
    expect([live.nextInvoice, live.since]).toEqual([
      m["billing.nextInvoice"].replace("{date}", "Nov 12"), m["billing.usage.since"].replace("{date}", "Oct 12"),
    ]);
    expect(view(row({ subscriptionStatus: "canceled" }), null).nextInvoice).toBeNull();
    // Not while `incomplete`: the first payment hasn't gone through, so a
    // next invoice date would be a guess (mutation: drop the incomplete
    // check → FAILS).
    expect(view(row({ subscriptionStatus: "incomplete" }), null).nextInvoice).toBeNull();
    expect(view(null, link("2026-10-16T20:30:00Z")).link).toEqual({
      sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/c/pay/cs_1",
    });
  });
});

describe("billingCardView: pause, lift and reconciliation (G3, G13, G19; M7a PR-4 Task 9)", () => {
  const view = (billing: AccountBilling | null, l: BillingLink | null, over: Partial<Parameters<typeof billingCardView>[0]> = {}) =>
    billingCardView({
      billing, link: l, plan: billing ? plan("p1") : null, activePlans: [plan("p1"), plan("p2")],
      used: { voice_minutes: 312, sms: 0, ai_chats: 0 }, zone: ZONE, now: NOW, defaultEmail: "owner@example.com",
      stripeReady: true, webhookReady: true, ...over,
    });

  it("a paused past_due row: the payment line with both dates, can.liftPause (mutation: offer Lift on a complimentary row → FAILS)", () => {
    const paused = row({ subscriptionStatus: "past_due", pastDueSince: "2026-10-01T17:00:00+00:00", billingPausedAt: "2026-10-08T17:00:00+00:00" });
    const v = view(paused, null);
    expect(v.pause).toEqual({ line: m["billing.card.pausedPayment"].replace("{date}", "Oct 8").replace("{failed}", "Oct 1"), noForward: null });
    expect(v.can.liftPause).toBe(true);
    // 0051's CHECK forbids a complimentary row from carrying a pause stamp,
    // but the pure function must still never offer Lift on one.
    const compPaused = row({
      complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null, stripeCustomerId: null,
      billingPausedAt: "2026-10-08T17:00:00+00:00",
    });
    expect(view(compPaused, null).can.liftPause).toBe(false);
  });

  it("an ended row: the ended line (mutation: always the payment line → FAILS)", () => {
    const paused = row({ subscriptionStatus: "canceled", billingPausedAt: "2026-10-08T17:00:00+00:00" });
    expect(view(paused, null).pause).toEqual({ line: m["billing.card.pausedEnded"].replace("{date}", "Oct 8"), noForward: null });
  });

  it("paused 30 days or more with the switch ON: the noForward line; with it off, none (mutation: show it from day 29 → FAILS; mutation: ignore `enforced` → FAILS)", () => {
    const day30 = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const day29 = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString();
    const paused30 = row({ subscriptionStatus: "past_due", pastDueSince: day30, billingPausedAt: day30 });
    const paused29 = row({ subscriptionStatus: "past_due", pastDueSince: day29, billingPausedAt: day29 });
    expect(view(paused30, null, { enforced: true }).pause?.noForward).toBe(m["billing.card.noForward"]);
    expect(view(paused29, null, { enforced: true }).pause?.noForward).toBeNull();
    expect(view(paused30, null, { enforced: false }).pause?.noForward).toBeNull();
  });

  it("lifted and still past_due: the lifted line, no Lift button (mutation: show Lift → FAILS)", () => {
    const lifted = row({
      subscriptionStatus: "past_due", pastDueSince: "2026-10-01T17:00:00+00:00",
      billingPausedAt: null, pauseLiftedAt: "2026-10-10T17:00:00+00:00",
    });
    const v = view(lifted, null);
    expect(v.lifted).toBe(m["billing.card.lifted"].replace("{date}", "Oct 10"));
    expect(v.pause).toBeNull();
    expect(v.can.liftPause).toBe(false);
  });

  it("lifted and the plan ended (canceled): the lifted line too (mutation: lifted only on payment_failed → FAILS)", () => {
    const lifted = row({ subscriptionStatus: "canceled", billingPausedAt: null, pauseLiftedAt: "2026-10-10T17:00:00+00:00" });
    expect(view(lifted, null).lifted).toBe(m["billing.card.lifted"].replace("{date}", "Oct 10"));
  });

  it("pauseOff only when a stamp exists and the switch is off (mutation: show it whenever off → FAILS)", () => {
    const paused = row({ subscriptionStatus: "past_due", billingPausedAt: "2026-10-08T17:00:00+00:00" });
    expect(view(paused, null, { enforced: false }).pauseOff).toBe(true);
    expect(view(paused, null, { enforced: true }).pauseOff).toBe(false);
    expect(view(row(), null, { enforced: false }).pauseOff).toBe(false);
  });

  it("reconciliations: null (the read failed) → no lines and reconciliationUnchecked; a list or none → checked (design review I2) (mutation: treat null as [] → FAILS)", () => {
    const failed = view(row(), null, { reconciliations: null });
    expect({ lines: failed.reconciliation, unchecked: failed.reconciliationUnchecked }).toEqual({ lines: [], unchecked: true });
    expect(view(row(), null, { reconciliations: [] }).reconciliationUnchecked).toBe(false);
    expect(view(row(), null).reconciliationUnchecked).toBe(false);
  });

  it("reconciliation lines only for the alerting verdicts, with the meter's words and the check time in the account's zone (mutation: show held_missing → FAILS)", () => {
    const recs: Reconciliation[] = [
      reconciliation({ meter: "sms", verdict: "stripe_over", stripeTotal: 1200, bisSettled: 1000, bisInFlight: 0, bisHeld: 0, checkedAt: "2026-10-15T20:30:00+00:00" }),
      reconciliation({ meter: "voice_minutes", verdict: "match" }),
      reconciliation({ meter: "ai_chats", verdict: "held_missing" }),
      reconciliation({ meter: "voice_minutes", verdict: "held_at_stripe" }),
      reconciliation({ meter: "ai_chats", verdict: "ambiguous", stripeTotal: 7, bisSettled: 3, bisInFlight: 0, bisHeld: 0, checkedAt: "2026-10-16T01:00:00+00:00" }),
    ];
    const v = view(row(), null, { reconciliations: recs });
    expect(v.reconciliation).toEqual([
      m["billing.card.reconcile.line"]
        .replace("{meter}", m["billing.card.reconcile.meter.sms"]).replace("{stripe}", "1,200").replace("{bis}", "1,000")
        .replace("{when}", formatMoment(new Date("2026-10-15T20:30:00+00:00"), ZONE)),
      m["billing.card.reconcile.line"]
        .replace("{meter}", m["billing.card.reconcile.meter.ai_chats"]).replace("{stripe}", "7").replace("{bis}", "3")
        .replace("{when}", formatMoment(new Date("2026-10-16T01:00:00+00:00"), ZONE)),
    ]);
  });
});

// S-10 T6: the client Billing page's own words, read through m[...] directly
// (English regardless of the reader's own choice). priceLine, includedLine,
// usageLines and billingCardView now take an optional trailing/field locale
// (default "en", every existing caller above unaffected) and read through
// t(); formatDay/formatMoment already took one (M7a PR-4), but billingCardView
// never passed it through to them.
describe("billing-view: Spanish (S-10 T6)", () => {
  it("priceLine reads '{price}/mes' in Spanish (mutation: drop the locale arg from the template lookup → FAILS)", () => {
    expect(priceLine(14900)).toBe("$149.00/month");
    expect(priceLine(14900, "es")).toBe("$149.00/mes");
  });

  it("includedLine and usageLines read in Spanish, with the same meter order and the same none-included rule (mutation: hard-code m[key] → FAILS)", () => {
    expect(includedLine({ voice_minutes: 500, sms: 1000, ai_chats: 200 }, "es"))
      .toBe("Incluye 500 minutos de llamadas, 1,000 mensajes de texto y 200 chats del sitio web cada mes.");
    expect(includedLine({ voice_minutes: 0, sms: 0, ai_chats: 0 }, "es")).toBe(m["billing.includes.none.es"]);
    const lines = usageLines({ voice_minutes: 500, sms: 1000, ai_chats: 0 }, { voice_minutes: 312, sms: 0, ai_chats: 4 }, "es");
    expect(lines.map((l) => l.text)).toEqual([
      "312 de 500 minutos", "0 de 1,000 mensajes de texto", "4 chats del sitio web (ninguno incluido)",
    ]);
  });

  it("billingCardView's since/nextInvoice read in the reader's language, with the date itself formatted in Spanish (mutation: thread locale into the t() call but not into formatDay → FAILS)", () => {
    const esView = billingCardView({
      billing: row(), link: null, plan: plan("p1"), activePlans: [plan("p1")],
      used: { voice_minutes: 312, sms: 0, ai_chats: 0 }, zone: ZONE, now: NOW, defaultEmail: "owner@example.com",
      stripeReady: true, webhookReady: true, locale: "es",
    });
    expect(esView.since).toBe(`Desde el ${formatDay(new Date("2026-10-12T17:00:00Z"), ZONE, "es")}`);
    expect(esView.nextInvoice).toBe(`Próxima factura el ${formatDay(new Date("2026-11-12T17:00:00Z"), ZONE, "es")}`);
  });

  it("billingCardView's pause and lifted lines read in Spanish, reusing the twins billing-paused-banner.tsx already ships (mutation: read m[key] directly → FAILS)", () => {
    const paused = row({ subscriptionStatus: "past_due", pastDueSince: "2026-10-01T17:00:00+00:00", billingPausedAt: "2026-10-08T17:00:00+00:00" });
    const v = billingCardView({
      billing: paused, link: null, plan: plan("p1"), activePlans: [plan("p1")],
      used: { voice_minutes: 0, sms: 0, ai_chats: 0 }, zone: ZONE, now: NOW, defaultEmail: "x@example.com",
      stripeReady: true, webhookReady: true, locale: "es",
    });
    expect(v.pause?.line).toBe(m["billing.card.pausedPayment.es"].replace("{date}", "8 oct").replace("{failed}", "1 oct"));
  });

  it("billingStatusTreatment translates the label only, keeping the same token classes BILLING_STATUS_TREATMENTS already carries (mutation: return the English label for es → FAILS)", () => {
    for (const status of Object.keys(BILLING_STATUS_TREATMENTS) as BillingStatus[]) {
      const es = billingStatusTreatment(status, "es");
      expect(es.label).toBe(m[`billing.status.${status}.es`]);
      expect(es.dot).toBe(BILLING_STATUS_TREATMENTS[status].dot);
      expect(es.chip).toBe(BILLING_STATUS_TREATMENTS[status].chip);
    }
    expect(billingStatusTreatment("active", "en")).toEqual(BILLING_STATUS_TREATMENTS.active);
  });
});
