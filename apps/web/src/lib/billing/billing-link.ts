import { randomUUID } from "node:crypto";
import {
  ENDED_STATUSES, getAccountBilling, getBillingLink, markBillingLinkExpired, saveBillingLink,
  type Branding, type Plan, type SupabaseClient,
} from "@bis/db";
import type { EmailProvider } from "@/lib/email";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { billingLinkEmail } from "@/lib/email/templates/billing-link";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { formatMoment, includedLine, priceLine } from "./billing-view";
import { idempotencyKey, type BillingGateway, type CheckoutInput, type CheckoutSession } from "./stripe-gateway";

/** Every visual field null: the platform's own unthemed identity, as the
 *  agency's weekly roll-up uses (weekly-agency-report.ts). G18; DECISION 1,
 *  danlo 2026-09-25: the billing link comes from BIS, in BIS's look. */
const BIS_BRANDING: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

export type SendBillingLinkInput = {
  accountId: string;
  /** Already checked by the caller: exists, active, the account's agency's. */
  plan: Plan;
  email: string;
  /** Customer-facing brand name, or null. */
  businessName: string | null;
  zone: string;
};

export type SendBillingLinkDeps = {
  db: SupabaseClient;
  gateway: BillingGateway;
  email: EmailProvider;
  /** Absolute origin for Checkout's return pages. */
  origin: string;
  /** When the Send STARTED: saved as the link's sent_at, which the mirror
   *  compares with the subscription's start to consume the link. */
  now: Date;
  replyTo?: string;
  /** Mints this Send's request id (tests pin it; production: a UUID). */
  newRequestId?: () => string;
};

export type SendBillingLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: "already_subscribed" | "checkout_finished" | "stripe_failed" | "stale" }
  | { ok: false; reason: "email_failed"; url: string };

/** A Stripe SDK error (every class sets .type to its own name). Anything
 *  else, a database error included, is not Stripe's and is rethrown. */
function isStripeError(e: unknown): boolean {
  const type = typeof e === "object" && e !== null ? (e as { type?: unknown }).type : undefined;
  return typeof type === "string" && type.startsWith("Stripe");
}

/** One mailbox, however it was typed: trimmed, case-insensitive. */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Anything shaped like an email address. Generous on purpose: a false
 *  match costs a word in a log line, a miss puts a person's address there. */
const EMAIL_LIKE = /[^\s<>()[\]{},;:"'`]+@[^\s<>()[\]{},;:"'`]+/g;

/**
 * An error as a log line may carry it: its class (the SDK's `.type`, else its
 * name), Stripe's `code` and HTTP status when present, and its message with
 * every email address replaced by "[email]", cut to 300 characters. Stripe's
 * and the mail provider's messages can quote the recipient ("Invalid email
 * address: …", "550 <…>: recipient rejected"), and a log is no place for a
 * client's address (review correction 4).
 */
export function loggableError(e: unknown): string {
  const o = typeof e === "object" && e !== null
    ? (e as { type?: unknown; name?: unknown; code?: unknown; statusCode?: unknown; message?: unknown })
    : {};
  const kind = typeof o.type === "string" ? o.type : typeof o.name === "string" ? o.name : typeof e;
  const code = typeof o.code === "string" ? ` code=${o.code}` : "";
  const status = typeof o.statusCode === "number" ? ` status=${o.statusCode}` : "";
  const raw = typeof o.message === "string" ? o.message : String(e);
  return `${kind}${code}${status}: ${raw.replace(EMAIL_LIKE, "[email]").slice(0, 300)}`;
}

/**
 * Spec flow 2 (plan G2, G3, G18). Order matters for money:
 *   refuse a live subscription → the previous session: complete → stop;
 *   open → mark the stored link expired, THEN expire it at Stripe → the
 *   customer → create the session → save it conditionally on the previous
 *   one → email it.
 *
 * THE CUSTOMER, and so the address Stripe's receipts and failed-payment
 * emails go to:
 *   - billed (the row holds a customer): always that one (G3), with its email
 *     moved to this recipient BEFORE the session is made; if that update
 *     fails, the Send stops at stripe_failed with nothing made or sent;
 *   - unbilled: the link's customer only when the link went to this same
 *     address (trimmed, case-insensitive), else a new customer.
 * Two Sends at once on a billed account both move the shared customer's
 * email before either saves; the loser ("stale") puts it back to the
 * winner's saved address, and only logs if that fails.
 *
 * THE KEYS. Each Stripe create is keyed on every parameter it sends PLUS this
 * Send's own request id, minted once per call. Within the call the SDK's own
 * network retries reuse the key, so a response lost on the wire replays the
 * object Stripe made instead of making a second. Across calls every Send is a
 * new request, for two reasons (plan review, 2026-09-25):
 *   1. A key made from the inputs alone replays a session Stripe already
 *      COMPLETED: paid, then canceled, then the same plan re-sent to the same
 *      address within Stripe's 24 h key window returns the paid session. Saved
 *      with a sent_at after its own subscription started, the mirror never
 *      consumes it, and every later Send stops at checkout_finished.
 *   2. Assumption (Stripe's idempotency docs, not re-read here; the installed
 *      SDK says the same in RequestSender.js's _shouldRetry: "our idempotency
 *      framework would typically replay it anyway"): Stripe saves a 500 under
 *      its key and replays it. An input-derived key would turn one transient
 *      Stripe error into a refused Send for that client for up to 24 hours.
 * Why a fresh key per Send is safe here: a client can only ever pay a session
 * that was SAVED and emailed, and the save is conditional on the previous
 * link (G2), so two Sends at once still leave one link, the loser expiring
 * its own session ("stale"). A session whose creation response never arrived
 * was never saved or emailed, so its URL reached nobody, and Stripe expires
 * it. A customer is created only while the billed row holds none and there
 * is no link to this address (G3), so the invariant "once billed, the
 * customer never changes" is untouched; a Send that fails after creating one
 * leaves an unused customer, which G3 already calls harmless.
 */
export async function sendBillingLink(deps: SendBillingLinkDeps, input: SendBillingLinkInput): Promise<SendBillingLinkResult> {
  const { db, gateway, now } = deps;
  const requestId = (deps.newRequestId ?? randomUUID)();
  const [billing, link] = await Promise.all([getAccountBilling(db, input.accountId), getBillingLink(db, input.accountId)]);
  if (billing?.subscriptionStatus && !ENDED_STATUSES.includes(billing.subscriptionStatus)) {
    return { ok: false, reason: "already_subscribed" };
  }

  let session: CheckoutSession;
  let customerId: string;
  try {
    if (link) {
      const status = await gateway.getCheckoutSessionStatus(link.checkoutSessionId);
      if (status === "complete") return { ok: false, reason: "checkout_finished" };
      if (status === "open") {
        await markBillingLinkExpired(db, input.accountId, link.checkoutSessionId, now);
        await gateway.expireCheckoutSession(link.checkoutSessionId);
      }
    }
    // WHICH customer (G3), and so which address Stripe's receipts and
    // failed-payment emails go to: Checkout shows an existing customer's own
    // email and does not write a typed one back (assumption, Stripe's docs),
    // and the portal cannot edit it (DECISION 3), so the customer must carry
    // the address this link is sent to.
    if (billing?.stripeCustomerId) {
      // Billed once: the customer never changes (the mirror refuses any
      // other as customer_changed). Its email follows the recipient. BIS does
      // not hold the customer's current email (the link that recorded it was
      // consumed at payment), so it is set every time; the same address again
      // changes nothing.
      customerId = billing.stripeCustomerId;
      await gateway.updateCustomerEmail(customerId, input.email, idempotencyKey("bis-customer-email", input.accountId, {
        customerId, email: input.email, requestId,
      }));
    } else if (link && sameAddress(link.sentTo, input.email)) {
      customerId = link.stripeCustomerId;
    } else {
      // Unbilled, and no link to this address: a new customer. The link's
      // old one was never billed, and its open session was expired above.
      const customer = { accountId: input.accountId, name: input.businessName, email: input.email };
      customerId = (await gateway.createCustomer(customer, idempotencyKey("bis-customer", input.accountId, { customer, requestId }))).id;
    }
    const checkout: CheckoutInput = {
      accountId: input.accountId, planId: input.plan.id, customerId, priceIds: input.plan.stripePriceIds,
      successUrl: `${deps.origin}/billing-done?result=success`, cancelUrl: `${deps.origin}/billing-done?result=cancelled`,
    };
    session = await gateway.createCheckoutSession(checkout, idempotencyKey("bis-checkout", input.accountId, { checkout, requestId }));
  } catch (e) {
    if (!isStripeError(e)) throw e;
    console.error(`billing link: Stripe refused for account ${input.accountId}: ${loggableError(e)}`);
    return { ok: false, reason: "stripe_failed" };
  }

  const saved = await saveBillingLink(db, {
    accountId: input.accountId, planId: input.plan.id, stripeCustomerId: customerId, checkoutSessionId: session.id,
    checkoutUrl: session.url, sentTo: input.email, expiresAt: new Date(session.expiresAt * 1000).toISOString(),
  }, link?.checkoutSessionId ?? null, now);
  if (!saved) {
    const current = await getBillingLink(db, input.accountId);
    // The stored link already names this very session: it is the LIVE link,
    // already emailed, so success and no second email. Unreachable with
    // per-Send keys (only this Send can have made this session); kept so an
    // input-derived key can never expire the live link.
    if (current?.checkoutSessionId === session.id) return { ok: true, url: session.url };
    try {
      await gateway.expireCheckoutSession(session.id);
    } catch (e) {
      console.error(`billing link: could not expire the losing session ${session.id}: ${loggableError(e)}`);
    }
    // A billed account's customer is shared by every Send, and this one
    // already moved its email to OUR address before losing. Put it back to
    // the address the winning (live) link went to, so receipts follow that
    // link. A failure here is logged, not thrown: the winner's link stands,
    // and its next Send sets the email again.
    if (billing?.stripeCustomerId && current && current.stripeCustomerId === customerId
      && !sameAddress(current.sentTo, input.email)) {
      try {
        await gateway.updateCustomerEmail(customerId, current.sentTo, idempotencyKey("bis-customer-email-restore", input.accountId, {
          customerId, email: current.sentTo, requestId,
        }));
      } catch (e) {
        console.error(`billing link: could not put the customer's email back for account ${input.accountId} after losing a race: ${loggableError(e)}`);
      }
    }
    return { ok: false, reason: "stale" };
  }

  const mail = billingLinkEmail({
    brand: emailBrandNamed(BIS_BRANDING, "BIS"), businessName: input.businessName, planName: input.plan.name,
    price: priceLine(input.plan.monthlyPriceCents), includes: includedLine(input.plan.allowances), url: session.url,
    expires: formatMoment(new Date(session.expiresAt * 1000), input.zone),
  });
  try {
    const replyTo = normalizeReplyTo(deps.replyTo);
    await deps.email.send({
      to: input.email, fromName: "BIS", ...(replyTo ? { replyTo } : {}),
      subject: mail.subject, body: mail.text, html: mail.html,
    });
  } catch (e) {
    console.error(`billing link: the email for account ${input.accountId} failed: ${loggableError(e)}`);
    return { ok: false, reason: "email_failed", url: session.url };
  }
  return { ok: true, url: session.url };
}
