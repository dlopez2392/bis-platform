"use server";

/**
 * The agency's Billing card actions (spec section 5; plan G2, G10, G15,
 * G16). requireAgency() is the FIRST line of every one: the Settings page is
 * agency-only, but a server action is a public POST endpoint, so each guards
 * itself. The account id is bound server-side by billing-section.tsx and
 * never travels as a form field. Writes go through serviceDb() (0051/0052
 * grant authenticated at most SELECT), and only after the guard.
 *
 * ASSUMPTION: ONE agency. requireAgency() admits any agency_admin to any
 * account; it does not check that the caller's agency owns this account.
 * With exactly one agency (plan G10: insertPlan and createAccount both use
 * agency row #1) that is the same thing. The plan checks below compare the
 * plan's agency with the ACCOUNT's, never the caller's. M7 #3 (multi-agency)
 * must scope the guard to the account's agency before a second one exists.
 */
import { headers } from "next/headers";
import {
  ENDED_STATUSES, changeComplimentaryPlan, getAccountBilling, getBillingLink, getBranding, getPlan,
  markComplimentary, mirrorSubscription, serviceDb, unmarkComplimentary, type Plan, type SupabaseClient,
} from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { loggableError, sendBillingLink, type SendBillingLinkResult } from "@/lib/billing/billing-link";
import { safeZone } from "@/lib/billing/billing-view";
import { planChangeItems } from "@/lib/billing/change-plan";
import { billingGatewayFromEnv, idempotencyKey } from "@/lib/billing/stripe-gateway";
import { getEmailProvider } from "@/lib/email";
import { configuredOrigin, originFrom } from "@/lib/email/origin";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { m, type MessageKey } from "@/lib/messages";

export type BillingActionResult = { ok: true } | { ok: false; error: string; url?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
/**
 * ONE bare address, as the Stripe customer's email and the To header get it:
 * no whitespace, `,` or `;` (a list is refused), and no `<` `>` `"` `'` (a
 * display-name form like `Name <a@b.co>`, or a quoted local part, is refused
 * rather than passed through as one odd "address"). Not forms' isValidEmail:
 * that refuses `_` and `%` because its value meets an ILIKE lookup
 * (lib/forms/guards.ts), and `first_last@…` is a real mailbox an agency types.
 */
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const fail = (key: MessageKey, url?: string): BillingActionResult =>
  (url ? { ok: false, error: m[key], url } : { ok: false, error: m[key] });
const field = (f: FormData, name: string): string => String(f.get(name) ?? "").trim();

type AccountRow = { id: string; agency_id: string; timezone: string | null };

async function loadAccount(db: SupabaseClient, accountId: string): Promise<AccountRow | null> {
  const { data, error } = await db.from("accounts").select("id, agency_id, timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`billing action: account read failed: ${error.message}`);
  return data as AccountRow | null;
}

/** A plan this account may be put on: exists, not archived, the account's
 *  own agency's (G10). Checked BEFORE any Stripe call. */
async function usablePlan(db: SupabaseClient, account: AccountRow, planId: string): Promise<Plan | null> {
  const plan = await getPlan(db, planId);
  return plan && !plan.archivedAt && plan.agencyId === account.agency_id ? plan : null;
}

/** Where a reply to the billing link lands (G18; DECISION 1). The email
 *  promises "If it runs out, reply and we'll send a new one", so it must name
 *  a mailbox BIS reads. The same variable and the same fallback as the
 *  Website page's "ask us" link (website/page.tsx), so both point at one
 *  address. One difference: that page's `??` keeps a blank value (a mailto
 *  with no address); here it is trimmed, and blank counts as unset
 *  (normalizeReplyTo), so a blank variable still gets the fallback. */
const AGENCY_SUPPORT_FALLBACK = "hello@bis-rgv.com";
function agencySupportReplyTo(): string {
  return normalizeReplyTo(process.env.AGENCY_SUPPORT_EMAIL) ?? AGENCY_SUPPORT_FALLBACK;
}

const SEND_ERRORS: Record<Exclude<SendBillingLinkResult, { ok: true }>["reason"], MessageKey> = {
  already_subscribed: "billing.error.alreadySubscribed",
  checkout_finished: "billing.error.checkoutFinished",
  stripe_failed: "billing.error.stripeFailed",
  stale: "billing.error.stale",
  email_failed: "billing.error.emailFailed",
};

export async function sendBillingLinkAction(accountId: string, formData: FormData): Promise<BillingActionResult> {
  await requireAgency();
  if (!isUuid(accountId)) return fail("billing.error.stale");
  const planId = field(formData, "planId");
  const email = field(formData, "email");
  if (!isUuid(planId)) return fail("billing.error.plan");
  if (email.length > 254 || !EMAIL.test(email)) return fail("billing.error.email");
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) return fail("billing.error.noStripe");
  const origin = configuredOrigin() ?? originFrom(await headers());
  if (!origin) return fail("billing.error.noOrigin");
  const db = serviceDb();
  const account = await loadAccount(db, accountId);
  if (!account) return fail("billing.error.stale");
  const [plan, branding] = await Promise.all([usablePlan(db, account, planId), getBranding(db, accountId)]);
  if (!plan) return fail("billing.error.plan");
  const result = await sendBillingLink(
    {
      db, gateway: gateway.gateway, email: getEmailProvider(), origin, now: new Date(),
      replyTo: agencySupportReplyTo(),
    },
    { accountId, plan, email, businessName: brandDisplayName(branding) || null, zone: safeZone(account.timezone) },
  );
  if (result.ok) return { ok: true };
  return fail(SEND_ERRORS[result.reason], result.reason === "email_failed" ? result.url : undefined);
}

/**
 * A stored link the card shows as dead is not proof Stripe agrees. Send marks
 * the stored link expired BEFORE it expires the session at Stripe
 * (billing-link.ts, G2 step 3), so a Stripe failure in between leaves an
 * emailed session the client can still PAY while the card shows no link and
 * offers Mark complimentary. A complimentary row holds no customer, so if the
 * client then paid that session, decideMirror would accept the subscription
 * on the link's customer and turn the account paid behind the agency's back.
 *
 * So Mark complimentary asks Stripe first, and marks only once Stripe says
 * the session can no longer be paid:
 *   expired  → "dead", nothing to do;
 *   open     → expire it at Stripe NOW, then "dead". Chosen over refusing:
 *              the card shows no link, so a refusal would name something the
 *              agency cannot see, and would last until Stripe's own expiry
 *              (up to a day, B2). This session is one BIS already decided to
 *              kill; this finishes that. If the client completes it between
 *              the read and the expire, the expire is refused (assumption
 *              X1 below) and this refuses too;
 *   complete → the client paid: "already finished checkout", nothing marked
 *              (a complimentary row over a paying subscription would hide it);
 *   any Stripe failure, or no usable key → refused, nothing marked. It fails
 *              closed: an unknown session state is never treated as dead.
 *
 * Two EXTERNAL assumptions carry the "open → expire → mark" branch. Neither
 * is verified here. FakeGateway models X1 and cannot show X2:
 *   X1. Stripe refuses to expire a session that is no longer `open` (its API
 *       reference says only an open session can be expired; the error class
 *       for it was never observed).
 *   X2. Once Stripe answers the expire, the session can never be paid, even
 *       with a payment already in flight (a card in a 3-D Secure challenge,
 *       say). If Stripe can still complete such a payment, the client could
 *       pay after this marks the account complimentary.
 * What settles them: Task 12's e2e against test mode. Expire a COMPLETED
 * session and read the error (X1); expire a session mid-3DS with a 3DS test
 * card, then finish the challenge (X2). Until then, the webhook's
 * customer_mismatch guard is NOT a backstop here: the stored link names the
 * session's customer, so decideMirror would accept it.
 */
async function settleDeadLink(sessionId: string, accountId: string): Promise<"dead" | MessageKey> {
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) return "billing.error.noStripe";
  try {
    const status = await gateway.gateway.getCheckoutSessionStatus(sessionId);
    if (status === "complete") return "billing.error.checkoutFinished";
    if (status === "open") await gateway.gateway.expireCheckoutSession(sessionId);
    return "dead";
  } catch (e) {
    console.error(`mark complimentary: could not confirm session ${sessionId} is dead for account ${accountId}: ${loggableError(e)}`);
    return "billing.error.stripeFailed";
  }
}

export async function markComplimentaryAction(accountId: string, formData: FormData): Promise<BillingActionResult> {
  await requireAgency();
  const planId = field(formData, "planId");
  if (!isUuid(accountId)) return fail("billing.error.stale");
  if (!isUuid(planId)) return fail("billing.error.plan");
  const db = serviceDb();
  const now = new Date();
  // Every refusal the database can decide comes BEFORE Stripe is asked or
  // told anything about the old link below: a refused Mark complimentary
  // never expires a session. markComplimentary re-checks the plan and the
  // row itself (a row appearing meanwhile is its already_billed).
  const account = await loadAccount(db, accountId);
  if (!account) return fail("billing.error.stale");
  const [plan, billing, link] = await Promise.all([
    usablePlan(db, account, planId), getAccountBilling(db, accountId), getBillingLink(db, accountId),
  ]);
  if (!plan) return fail("billing.error.plan");
  // Any row, a canceled paid one included: no complimentary over a canceled
  // subscription (G16; DECISION 8).
  if (billing) return fail("billing.error.alreadyBilled");
  // G16: never while a live link is out; the card hides the button then,
  // and this is the check a stale card cannot skip.
  if (link && Date.parse(link.expiresAt) > now.getTime()) return fail("billing.error.stale");
  if (link) {
    const settled = await settleDeadLink(link.checkoutSessionId, accountId);
    if (settled !== "dead") return fail(settled);
  }
  const r = await markComplimentary(db, { accountId, planId, now });
  if (r.ok) return { ok: true };
  if (r.reason === "already_billed") return fail("billing.error.alreadyBilled");
  return fail(r.reason === "unknown_account" ? "billing.error.stale" : "billing.error.plan");
}

export async function removeComplimentaryAction(accountId: string): Promise<BillingActionResult> {
  await requireAgency();
  if (!isUuid(accountId)) return fail("billing.error.stale");
  return (await unmarkComplimentary(serviceDb(), accountId)) ? { ok: true } : fail("billing.error.stale");
}

export async function changePlanAction(accountId: string, formData: FormData): Promise<BillingActionResult> {
  await requireAgency();
  const planId = field(formData, "planId");
  const expectedPlanId = field(formData, "expectedPlanId");
  const requestId = field(formData, "requestId");
  if (!isUuid(accountId) || !isUuid(expectedPlanId) || !isUuid(requestId)) return fail("billing.error.stale");
  if (!isUuid(planId)) return fail("billing.error.plan");
  const db = serviceDb();
  const account = await loadAccount(db, accountId);
  if (!account) return fail("billing.error.stale");
  const [plan, billing] = await Promise.all([usablePlan(db, account, planId), getAccountBilling(db, accountId)]);
  if (!plan) return fail("billing.error.plan");
  if (!billing || billing.planId !== expectedPlanId) return fail("billing.error.stale");

  if (billing.complimentary) {
    const r = await changeComplimentaryPlan(db, { accountId, planId, expectedPlanId, now: new Date() });
    if (r.ok) return { ok: true };
    return fail(r.reason === "stale" || r.reason === "unknown_account" ? "billing.error.stale" : "billing.error.plan");
  }

  // Not on an ended subscription, and not on `incomplete`: before the first
  // payment, Stripe may refuse item updates (G15; the card hides it too).
  if (!billing.stripeSubscriptionId || !billing.subscriptionStatus || ENDED_STATUSES.includes(billing.subscriptionStatus)
    || billing.subscriptionStatus === "incomplete") {
    return fail("billing.error.stale");
  }
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) return fail("billing.error.noStripe");
  let subscriptionId: string;
  try {
    const snapshot = await gateway.gateway.retrieveSubscription(billing.stripeSubscriptionId);
    const items = planChangeItems(snapshot, plan.stripePriceIds);
    if (!items) {
      console.error(`change plan: subscription ${snapshot.id} is not BIS's four items; refusing to move it`);
      return fail("billing.error.stripeFailed");
    }
    const change = { subscriptionId: snapshot.id, planId, items };
    await gateway.gateway.updateSubscriptionPrices(change, idempotencyKey("bis-subchange", requestId, change));
    subscriptionId = snapshot.id;
  } catch (e) {
    console.error(`change plan: Stripe refused for account ${accountId}: ${loggableError(e)}`);
    return fail("billing.error.stripeFailed");
  }
  // Outside the try: Stripe has the change, so a database failure here must
  // NOT say "nothing was charged". It throws (the card shows the generic
  // crash toast) and the webhook's own mirror lands the same row shortly.
  // The mirror is handed the READER, not a snapshot: it reads the stored row
  // before it asks Stripe (compare-and-set, B5).
  const stripe = gateway.gateway;
  const mirrored = await mirrorSubscription(db, () => stripe.retrieveSubscription(subscriptionId), () => new Date());
  // Stripe HAS the change, so the answer stays ok. But a refusal means the
  // card will not show it, and the webhook's mirror will refuse it the same
  // way: say so where someone can find it.
  if (mirrored.kind === "refused") {
    console.error(`change plan: Stripe changed ${subscriptionId} for account ${accountId}, but the mirror refused it (${mirrored.reason}); the card still shows the old plan`);
  }
  return { ok: true };
}
