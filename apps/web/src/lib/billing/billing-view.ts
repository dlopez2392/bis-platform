import {
  ALERTING_VERDICTS, ENDED_STATUSES, METER_KEYS, PAST_DUE_STATUSES, isUsableZone,
  type AccountBilling, type BillingLink, type MeterAmounts, type MeterKey, type Plan, type Reconciliation,
} from "@bis/db";
import { localMidnightInstant } from "@/lib/reports/weekly-window";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { tag } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";
import { formatCents } from "./plan-form";
import { PAUSE_FORWARD_MS, pauseCause } from "./standing";

/**
 * What the billing screens SAY, computed from stored rows (never from
 * Stripe at render time). Pure: the agency card, the client page and the
 * banner all read these, so the three can never disagree.
 */

/** Seven words, one per state the card must not hide (plan G13). */
export type BillingStatus = "active" | "payment_failed" | "paused" | "canceled" | "complimentary" | "link_sent" | "unbilled";

export function billingStatusOf(billing: AccountBilling | null, link: Pick<BillingLink, "expiresAt"> | null, now: Date): BillingStatus {
  const linkLive = link !== null && Date.parse(link.expiresAt) > now.getTime();
  if (!billing) return linkLive ? "link_sent" : "unbilled";
  if (billing.billingPausedAt) return "paused";
  if (billing.complimentary) return "complimentary";
  switch (billing.subscriptionStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "payment_failed";
    case "paused":
      return "paused";
    default:
      return linkLive ? "link_sent" : "canceled";
  }
}

/** The payment-failed banner (G21): only a subscription whose payment
 *  FAILED (past_due, unpaid). Not `incomplete`: a first payment still in
 *  progress has not failed, and the card already shows that state.
 *  Decided from the live VERDICT (design review I1), never from the stored
 *  pause stamp: with the switch off, or a verdict read that failed open, a
 *  stamped past-due row has no paused banner, so it must get this one —
 *  otherwise it got neither. While the verdict is paused the paused banner
 *  stands instead (never both). */
export function showsPaymentFailedBanner(billing: AccountBilling | null, verdict: { paused: boolean }): boolean {
  return !verdict.paused && billing !== null && !billing.complimentary
    && billing.subscriptionStatus !== null && PAST_DUE_STATUSES.includes(billing.subscriptionStatus);
}

/** DESIGN rule 3: a dot AND a word. Token classes only (pinned by a test). */
export const BILLING_STATUS_TREATMENTS: Record<BillingStatus, { label: string; dot: string; chip: string }> = {
  active: { label: m["billing.status.active"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  payment_failed: { label: m["billing.status.payment_failed"], dot: "bg-destructive", chip: "border-destructive/30 bg-destructive/10 text-foreground" },
  paused: { label: m["billing.status.paused"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
  canceled: { label: m["billing.status.canceled"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
  complimentary: { label: m["billing.status.complimentary"], dot: "bg-success", chip: "border-border bg-transparent text-foreground" },
  link_sent: { label: m["billing.status.link_sent"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
  unbilled: { label: m["billing.status.unbilled"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
};

const BILLING_STATUS_KEY: Record<BillingStatus, MessageKey> = {
  active: "billing.status.active", payment_failed: "billing.status.payment_failed", paused: "billing.status.paused",
  canceled: "billing.status.canceled", complimentary: "billing.status.complimentary", link_sent: "billing.status.link_sent",
  unbilled: "billing.status.unbilled",
};

/**
 * S-10 T6: BILLING_STATUS_TREATMENTS above is a module-level English
 * constant — correct for its agency-only and styleguide readers (Q4 stays
 * English), wrong for the client Billing page, which reads the SAME status
 * word. Same dot/chip token classes; only the label is re-read through t().
 */
export function billingStatusTreatment(status: BillingStatus, locale: Locale): { label: string; dot: string; chip: string } {
  return { ...BILLING_STATUS_TREATMENTS[status], label: t(m, BILLING_STATUS_KEY[status], locale) };
}

/** The zone a billing date is shown in: the account's own, when usable. */
export const FALLBACK_ZONE = "America/Chicago";
export function safeZone(tz: string | null | undefined): string {
  return tz && isUsableZone(tz) ? tz : FALLBACK_ZONE;
}

/** Local midnight on the 1st of `now`'s month, in `zone`. */
export function monthStartInZone(now: Date, zone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) throw new Error(`monthStartInZone: no year/month for ${now.toISOString()} in ${zone}`);
  return localMidnightInstant(`${year}-${month}-01`, zone);
}

/** A subscription BIS still bills (not ended, not complimentary). */
function liveSubscription(billing: AccountBilling): boolean {
  return !billing.complimentary && billing.subscriptionStatus !== null && !ENDED_STATUSES.includes(billing.subscriptionStatus);
}

/** Where "this month" starts (G12): Stripe's period for a live subscription,
 *  else the calendar month in the account's zone. */
export function usagePeriodStart(billing: AccountBilling, zone: string, now: Date): { start: Date; kind: "billing_period" | "calendar_month" } {
  if (liveSubscription(billing) && billing.currentPeriodStart) {
    return { start: new Date(billing.currentPeriodStart), kind: "billing_period" };
  }
  return { start: monthStartInZone(now, zone), kind: "calendar_month" };
}

/** Defence, not a fix for something seen here: neither Node 22 (CI) nor 24
 *  puts a narrow no-break space before AM/PM today (measured) — but some ICU
 *  build might, and it would be invisible in a browser while breaking an
 *  exact-string copy assertion or an email client's wrapping. Normalises
 *  that character and an ordinary no-break space to a plain one either way. */
const plainSpaces = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

export function formatDay(d: Date, zone: string, locale: Locale = "en"): string {
  return plainSpaces(new Intl.DateTimeFormat(tag(locale), { timeZone: zone, month: "short", day: "numeric" }).format(d));
}

export function formatMoment(d: Date, zone: string, locale: Locale = "en"): string {
  return plainSpaces(new Intl.DateTimeFormat(tag(locale), {
    timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(d));
}

const count = (n: number, locale: Locale = "en"): string => n.toLocaleString(tag(locale));

export function priceLine(cents: number, locale: Locale = "en"): string {
  return t(m, "billing.price", locale, { price: formatCents(cents) });
}

const INCLUDED_COPY: Record<MeterKey, MessageKey> = {
  voice_minutes: "billing.includes.minutes", sms: "billing.includes.sms", ai_chats: "billing.includes.chats",
};

/** "It includes 500 minutes of calls, 1,000 texts and 200 website chats each
 *  month." Only what the plan includes: a zero allowance is left out (never
 *  "0 minutes of calls"), and a plan that includes nothing says so plainly.
 *  The English join word ("and") stays literal only on the "en" branch; the
 *  Spanish list joins with a bare " y " (no serial comma, the glossary's own
 *  convention for a generated list — the website sentence's precedent). */
export function includedLine(a: MeterAmounts, locale: Locale = "en"): string {
  const parts = METER_KEYS.filter((k) => a[k] > 0).map((k) => t(m, INCLUDED_COPY[k], locale, { n: count(a[k], locale) }));
  if (parts.length === 0) return t(m, "billing.includes.none", locale);
  const join = locale === "es" ? " y " : " and ";
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")}${join}${parts[parts.length - 1]!}`;
  return t(m, "billing.includes", locale, { list });
}

export type UsageLine = { meter: MeterKey; used: number; included: number; over: boolean; text: string };

const USAGE_COPY: Record<MeterKey, { of: MessageKey; none: MessageKey }> = {
  voice_minutes: { of: "billing.usage.minutes", none: "billing.usage.minutes.none" },
  sms: { of: "billing.usage.sms", none: "billing.usage.sms.none" },
  ai_chats: { of: "billing.usage.chats", none: "billing.usage.chats.none" },
};

/** "312 of 500 minutes", one line per meter, in METER_KEYS order. */
export function usageLines(allowances: MeterAmounts, used: MeterAmounts, locale: Locale = "en"): UsageLine[] {
  return METER_KEYS.map((meter) => {
    const included = allowances[meter];
    const text = included === 0
      ? t(m, USAGE_COPY[meter].none, locale, { used: count(used[meter], locale) })
      : t(m, USAGE_COPY[meter].of, locale, { used: count(used[meter], locale), included: count(included, locale) });
    return { meter, used: used[meter], included, over: used[meter] > included, text };
  });
}

export type PlanOption = { id: string; name: string; price: string };

export type BillingCardView = {
  status: BillingStatus;
  plan: PlanOption | null;
  usage: UsageLine[];
  since: string | null;
  nextInvoice: string | null;
  link: { sentTo: string; expires: string; url: string } | null;
  planOptions: PlanOption[];
  defaultEmail: string;
  can: { send: boolean; changePlan: boolean; markComplimentary: boolean; stopComplimentary: boolean; copyLink: boolean; liftPause: boolean };
  stripeReady: boolean;
  webhookReady: boolean;
  /** The pause line (payment or ended cause) and, from day 30 while the
   *  switch enforces it, the "calls are no longer forwarded" line (G19, m3). */
  pause: { line: string; noForward: string | null } | null;
  /** "Pause lifted {date}" while a lift stands over a still-unpaid or ended
   *  plan (M10) — never once paid, and never alongside `pause`. */
  lifted: string | null;
  /** True while a pause stamp is stored but the switch does not enforce it
   *  (G19): "Pausing is switched off for this app, so this pause changes nothing." */
  pauseOff: boolean;
  /** One line per (account, meter) whose newest check is an alerting verdict
   *  (G13, G14). */
  reconciliation: string[];
  /** The reconciliation read failed (design review I2): the card says it
   *  couldn't check, in place of the mismatch block, and keeps the rest. */
  reconciliationUnchecked: boolean;
};

export function billingCardView(input: {
  billing: AccountBilling | null;
  link: BillingLink | null;
  /** The account's plan (billing.planId), read by the caller. */
  plan: Plan | null;
  /** Unarchived plans, for the pickers. */
  activePlans: Plan[];
  /** sumUsageSince from usagePeriodStart, or null when unbilled. */
  used: MeterAmounts | null;
  zone: string;
  now: Date;
  defaultEmail: string;
  /** A usable Stripe key here (stripeKeyVerdict). */
  stripeReady: boolean;
  /** STRIPE_WEBHOOK_SECRET is set here (webhookSecretFromEnv). Gates Send
   *  ONLY: without it a client could pay and stay Unbilled (final review I1). */
  webhookReady: boolean;
  /** The account's newest reconciliation rows (Task 2's listReconciliations).
   *  Optional, defaulting to none; null means the read FAILED (design review
   *  I2), which the card states instead of claiming nothing is wrong. */
  reconciliations?: Reconciliation[] | null;
  /** billingEnforced() (Task 4). Optional, defaulting to false, until the
   *  caller (Task 11) wires it — unenforced, the card makes no claim about
   *  calls or automations the switch is not actually acting on. */
  enforced?: boolean;
  /** S-10 T6: the reader's own locale. Optional, defaulting to "en" — the
   *  agency's Settings card and styleguide never pass one (Q4 keeps those
   *  screens English); the client Billing page passes its resolved locale. */
  locale?: Locale;
}): BillingCardView {
  const { billing, link, plan, activePlans, used, zone, now, stripeReady, webhookReady } = input;
  const locale = input.locale ?? "en";
  const reconciliationUnchecked = input.reconciliations === null;
  const reconciliations = input.reconciliations ?? [];
  const enforced = input.enforced ?? false;
  const status = billingStatusOf(billing, link, now);
  const option = (p: Plan): PlanOption => ({ id: p.id, name: p.name, price: priceLine(p.monthlyPriceCents, locale) });
  const live = billing !== null && liveSubscription(billing);
  // A live link can coexist with a `complimentary` row (Send is offered on
  // complimentary, G1's complimentary→paid): the status word is `complimentary`,
  // not `link_sent`, so the link is surfaced by ITS OWN liveness, not the
  // status. Only a live Stripe subscription hides it — nothing else can, in
  // that case, still be waiting on this link.
  const linkLive = link !== null && Date.parse(link.expiresAt) > now.getTime();
  const period = billing ? usagePeriodStart(billing, zone, now) : null;
  const otherPlan = activePlans.some((p) => p.id !== billing?.planId);
  const pausedAt = billing?.billingPausedAt ?? null;
  const pause = pausedAt && billing
    ? {
        line: pauseCause(billing) === "ended"
          ? t(m, "billing.card.pausedEnded", locale, { date: formatDay(new Date(pausedAt), zone, locale) })
          : t(m, "billing.card.pausedPayment", locale, {
              date: formatDay(new Date(pausedAt), zone, locale),
              failed: formatDay(new Date(billing.pastDueSince ?? pausedAt), zone, locale),
            }),
        // m3: a claim about calls, so only while the switch enforces it.
        noForward: enforced && now.getTime() - Date.parse(pausedAt) >= PAUSE_FORWARD_MS ? t(m, "billing.card.noForward", locale) : null,
      }
    : null;
  // M10: on a still-unpaid OR an ended plan.
  const lifted = !pausedAt && billing?.pauseLiftedAt && (status === "payment_failed" || status === "canceled")
    ? t(m, "billing.card.lifted", locale, { date: formatDay(new Date(billing.pauseLiftedAt), zone, locale) }) : null;
  const reconciliation = reconciliations
    .filter((r) => ALERTING_VERDICTS.includes(r.verdict))
    .map((r) => t(m, "billing.card.reconcile.line", locale, {
      meter: t(m, `billing.card.reconcile.meter.${r.meter}` as MessageKey, locale),
      stripe: count(r.stripeTotal, locale), bis: count(r.bisSettled + r.bisInFlight + r.bisHeld, locale),
      when: formatMoment(new Date(r.checkedAt), zone, locale),
    }));
  return {
    status,
    plan: plan ? option(plan) : null,
    usage: plan && used ? usageLines(plan.allowances, used, locale) : [],
    since: period ? t(m, "billing.usage.since", locale, { date: formatDay(period.start, zone, locale) }) : null,
    // Not while `incomplete`: the first payment hasn't gone through, so
    // promising a next invoice date would be a guess (G21's same reasoning).
    nextInvoice: live && billing?.subscriptionStatus !== "incomplete" && billing?.currentPeriodEnd
      ? t(m, "billing.nextInvoice", locale, { date: formatDay(new Date(billing.currentPeriodEnd), zone, locale) })
      : null,
    link: linkLive && !live && link
      ? { sentTo: link.sentTo, expires: formatMoment(new Date(link.expiresAt), zone, locale), url: link.checkoutUrl }
      : null,
    planOptions: activePlans.map(option),
    defaultEmail: input.defaultEmail,
    can: {
      send: stripeReady && webhookReady && activePlans.length > 0 && ["unbilled", "link_sent", "canceled", "complimentary"].includes(status),
      // Not on `incomplete`: before the first payment, Stripe may refuse item updates (G15).
      changePlan: otherPlan && (status === "complimentary"
        || (stripeReady && live && billing?.subscriptionStatus !== "incomplete")),
      markComplimentary: status === "unbilled" && activePlans.length > 0,
      stopComplimentary: status === "complimentary",
      copyLink: linkLive && !live,
      liftPause: pausedAt !== null && billing !== null && !billing.complimentary,
    },
    stripeReady,
    webhookReady,
    pause,
    lifted,
    pauseOff: pausedAt !== null && !enforced,
    reconciliation,
    reconciliationUnchecked,
  };
}
