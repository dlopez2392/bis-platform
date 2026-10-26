import {
  PAID_STATUSES, PAST_DUE_STATUSES, type AccountBilling, type BillingStanding, type SubscriptionStatus,
} from "@bis/db";

/**
 * What a billed account may do, decided from STORED rows only (no Stripe
 * call). Pure. Plan G1 (when to pause), G5 (the verdict), G6 (freshness),
 * G9 (why a call is not Sofía's, and whether it may still ring the business).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spec section 3 flow 5: "≥ 7 days old". */
export const PAUSE_GRACE_MS = 7 * DAY_MS;
/** G6: Stripe's word on the unpaid status must be this recent. The nightly
 *  step re-reads every unpaid subscription once a day; two hours of slack. */
export const STRIPE_FRESH_MS = 26 * 60 * 60 * 1000;
/** I7: a paused account's calls ring the business for this long, then the
 *  caller hears the call-back message instead. Equal to @bis/db's
 *  PAUSE_ALERT_FORWARD_MS (the work queue's 30-day line); a test pins it. */
export const PAUSE_FORWARD_MS = 30 * DAY_MS;

export type PauseDecision = "pause" | "unpause" | "keep" | "unconfirmed";

/** An instant, or null for a missing OR unreadable stamp (NaN would slip
 *  past every `<` below). What null means is per field, in decidePause:
 *   - pastDueSince: never "long enough ago" → keep (no pause on a bad stamp);
 *   - pauseLiftedAt: no lift → the lift does not hold, so the row may pause;
 *   - stripeCheckedAt: no confirmation → "unconfirmed", never pause;
 *   - currentPeriodEnd on a CANCELED plan: no end to wait for → it PAUSES
 *     (unless any lift stands: with no end to compare, any lift keeps — the
 *     deferred edge in plan G1, assumption S3). */
const at = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

export function decidePause(row: AccountBilling, now: Date): PauseDecision {
  if (row.complimentary || !row.stripeSubscriptionId || row.subscriptionStatus === null) return "keep";
  const status = row.subscriptionStatus;
  const t = now.getTime();
  const lifted = at(row.pauseLiftedAt);
  if (row.billingPausedAt) return PAID_STATUSES.includes(status) ? "unpause" : "keep";
  if (PAST_DUE_STATUSES.includes(status)) {
    const since = at(row.pastDueSince);
    if (since === null || t - since < PAUSE_GRACE_MS) return "keep";
    // Q4: a Lift holds until they pay or a NEW stretch starts.
    if (lifted !== null && lifted >= since) return "keep";
    const checked = at(row.stripeCheckedAt);
    // G6 / review I1: Stripe said "still unpaid" AFTER the grace ended, and recently.
    if (checked === null || checked - since < PAUSE_GRACE_MS || t - checked > STRIPE_FRESH_MS) return "unconfirmed";
    return "pause";
  }
  if (status === "canceled") {
    const end = at(row.currentPeriodEnd);
    if (end !== null && end > t) return "keep";
    if (lifted !== null && (end === null || lifted >= end)) return "keep";
    return "pause";
  }
  // incomplete, incomplete_expired (a first checkout that never paid: never
  // served on a plan), Stripe's own paused (S6), active, trialing.
  return "keep";
}

/** Why a paused account is paused (banner, card, page). */
export function pauseCause(row: { subscriptionStatus: SubscriptionStatus | null }): "payment" | "ended" {
  return row.subscriptionStatus === "canceled" ? "ended" : "payment";
}

export type BillingVerdict = { paused: boolean; voice: boolean; concierge: boolean; forward: boolean };
export const ALL_ON: BillingVerdict = Object.freeze({ paused: false, voice: true, concierge: true, forward: true });

/** G5. Unbilled (null) and switch-off are ALL_ON. Complimentary rows follow
 *  their plan and are never paused (0051's CHECK). */
export function billingVerdict(standing: BillingStanding | null, enforced: boolean, now: Date): BillingVerdict {
  if (!enforced || standing === null) return ALL_ON;
  const pausedAt = at(standing.pausedAt);
  const paused = pausedAt !== null;
  return {
    paused,
    voice: !paused && standing.features.voice_receptionist === true,
    concierge: !paused && standing.features.web_concierge === true,
    forward: pausedAt === null || now.getTime() - pausedAt < PAUSE_FORWARD_MS,
  };
}

/** The recorded reason a call is not Sofía's (0099's two values), and
 *  whether it may still be forwarded (G9). */
export function voiceBlock(v: BillingVerdict): { reason: "billing-paused" | "plan-no-voice"; forward: boolean } | null {
  if (v.paused) return { reason: "billing-paused", forward: v.forward };
  return v.voice ? null : { reason: "plan-no-voice", forward: true };
}
