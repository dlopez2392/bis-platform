import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanFeatures, PlanPriceKey } from "./billing";
import { ALERTING_VERDICTS, reconcileNightStart } from "./billing-reconciliations";

/**
 * The billed-account state (0051 account_billing, 0052 billing_links) and
 * the Stripe webhook ledger (0051 stripe_webhook_events). The ONLY module
 * that writes them. Every writer needs serviceDb() (authenticated holds at
 * most SELECT); callers guard first: requireAgency() for the agency's
 * actions, a verified Stripe signature for the webhook. There is no
 * updated_at trigger (0051): every writer sets it.
 */

export const SUBSCRIPTION_STATUSES = [
  "incomplete", "incomplete_expired", "trialing", "active", "past_due", "unpaid", "canceled", "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
/** Over for good: a new subscription may replace one in these. */
export const ENDED_STATUSES: readonly SubscriptionStatus[] = ["incomplete_expired", "canceled"];
/** Unpaid: past_due_since is stamped while the subscription sits in one of these (G8). */
export const PAST_DUE_STATUSES: readonly SubscriptionStatus[] = ["past_due", "unpaid"];
/** Paid: a mirror write in one of these clears the non-payment pause (M7a PR-4, plan G2). */
export const PAID_STATUSES: readonly SubscriptionStatus[] = ["active", "trialing"];

export function isSubscriptionStatus(s: string): s is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The primary keys (0051, 0052; Postgres's default names, read from the live
 *  catalog 2026-09-25). A 23505 on one of THESE is "this account's row
 *  appeared meanwhile": the race the callers below answer. */
const ACCOUNT_BILLING_PKEY = "account_billing_pkey";
const BILLING_LINKS_PKEY = "billing_links_pkey";

/**
 * The unique constraint a 23505 names, or null for any other error. Postgres
 * puts it in quotes in the message and PostgREST relays that text
 * (billing.ts's uniqueViolation reads the same). Both tables carry MORE than
 * one unique key: a 23505 on stripe_customer_id or stripe_subscription_id
 * means ANOTHER account already holds that Stripe object, which no retry can
 * fix. So callers treat ONLY the primary key as a race and throw on anything
 * else (review correction on Task 1, 2026-09-25). An unparseable message
 * yields "" and so throws too: failing loud, never looping.
 */
function uniqueViolated(error: { code?: string; message: string }): string | null {
  if (error.code !== "23505") return null;
  return /unique constraint "([^"]+)"/.exec(error.message)?.[1] ?? "";
}

/** The error for a failed write, naming the unique key when there is one. */
function writeFailed(what: string, error: { code?: string; message: string }): Error {
  const key = uniqueViolated(error);
  return new Error(key === null
    ? `${what} failed: ${error.message}`
    : `${what} refused by unique key ${key || "(unnamed)"}: another row already holds that value, so a retry cannot succeed: ${error.message}`);
}

export type AccountBilling = {
  accountId: string;
  planId: string;
  complimentary: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
  billingPausedAt: string | null;
  /** When the agency last lifted the pause (0099). */
  pauseLiftedAt: string | null;
  /** When the mirror last wrote what Stripe said (0099). */
  stripeCheckedAt: string | null;
  /** As PostgREST returns it (microseconds). Never re-serialise it. */
  billingStartedAt: string;
  createdAt: string;
  updatedAt: string;
};

type AccountBillingDbRow = {
  account_id: string; plan_id: string; complimentary: boolean;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null; current_period_start: string | null;
  current_period_end: string | null; past_due_since: string | null; billing_paused_at: string | null;
  pause_lifted_at: string | null; stripe_checked_at: string | null;
  billing_started_at: string; created_at: string; updated_at: string;
};

// ONE string literal, never a `+` concatenation: supabase-js parses the
// select text at the type level, and a widened `string` types the row as a
// GenericStringError (caught typechecking this plan, 2026-09-25).
const BILLING_COLUMNS =
  "account_id, plan_id, complimentary, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_start, current_period_end, past_due_since, billing_paused_at, pause_lifted_at, stripe_checked_at, billing_started_at, created_at, updated_at";

function toBilling(r: AccountBillingDbRow): AccountBilling {
  return {
    accountId: r.account_id, planId: r.plan_id, complimentary: r.complimentary,
    stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id,
    subscriptionStatus: r.subscription_status, currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end, pastDueSince: r.past_due_since, billingPausedAt: r.billing_paused_at,
    pauseLiftedAt: r.pause_lifted_at, stripeCheckedAt: r.stripe_checked_at,
    billingStartedAt: r.billing_started_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** The account's billing row, or null (= unbilled). Works on the RLS client
 *  for the agency and for the account's own client (0051 policy). */
export async function getAccountBilling(db: SupabaseClient, accountId: string): Promise<AccountBilling | null> {
  const { data, error } = await db.from("account_billing").select(BILLING_COLUMNS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getAccountBilling failed: ${error.message}`);
  return data ? toBilling(data as AccountBillingDbRow) : null;
}

export type BillingLink = {
  accountId: string;
  planId: string;
  stripeCustomerId: string;
  checkoutSessionId: string;
  checkoutUrl: string;
  sentTo: string;
  expiresAt: string;
  sentAt: string;
  updatedAt: string;
};
export type BillingLinkWrite = Omit<BillingLink, "sentAt" | "updatedAt">;

type BillingLinkDbRow = {
  account_id: string; plan_id: string; stripe_customer_id: string; checkout_session_id: string;
  checkout_url: string; sent_to: string; expires_at: string; sent_at: string; updated_at: string;
};
const LINK_COLUMNS = "account_id, plan_id, stripe_customer_id, checkout_session_id, checkout_url, sent_to, expires_at, sent_at, updated_at";

/** service_role only (0052): call with serviceDb() after requireAgency(). */
export async function getBillingLink(db: SupabaseClient, accountId: string): Promise<BillingLink | null> {
  const { data, error } = await db.from("billing_links").select(LINK_COLUMNS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getBillingLink failed: ${error.message}`);
  if (!data) return null;
  const r = data as BillingLinkDbRow;
  return {
    accountId: r.account_id, planId: r.plan_id, stripeCustomerId: r.stripe_customer_id,
    checkoutSessionId: r.checkout_session_id, checkoutUrl: r.checkout_url, sentTo: r.sent_to,
    expiresAt: r.expires_at, sentAt: r.sent_at, updatedAt: r.updated_at,
  };
}

/**
 * Stores the link just made. OPTIMISTIC on the previous session (G2): with
 * `expectedSessionId` null it inserts, and a row that appeared meanwhile is a
 * 23505 on billing_links_pkey → false (a 23505 on the customer key THROWS:
 * another account's link holds it); otherwise it updates only while the stored session is still
 * `expectedSessionId` → false when another tab replaced it first. The caller
 * expires its own new session on false.
 */
export async function saveBillingLink(
  db: SupabaseClient, link: BillingLinkWrite, expectedSessionId: string | null, now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const row = {
    plan_id: link.planId, stripe_customer_id: link.stripeCustomerId, checkout_session_id: link.checkoutSessionId,
    checkout_url: link.checkoutUrl, sent_to: link.sentTo, expires_at: link.expiresAt, sent_at: at, updated_at: at,
  };
  if (expectedSessionId === null) {
    const { error } = await db.from("billing_links").insert({ account_id: link.accountId, ...row });
    if (!error) return true;
    // Only THIS account's row appearing is the lost race. A 23505 on
    // stripe_customer_id means another account's link holds this customer
    // (e.g. after a manual customer change, G3): "Something changed" would
    // repeat forever, so it throws instead.
    if (uniqueViolated(error) === BILLING_LINKS_PKEY) return false;
    throw writeFailed("saveBillingLink insert", error);
  }
  const { data, error } = await db.from("billing_links").update(row)
    .eq("account_id", link.accountId).eq("checkout_session_id", expectedSessionId).select("account_id");
  if (error) throw new Error(`saveBillingLink update failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Marks the stored link expired NOW, before its Stripe session is expired,
 *  so a failure after this never leaves a dead link shown as live (G2). */
export async function markBillingLinkExpired(db: SupabaseClient, accountId: string, sessionId: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const { error } = await db.from("billing_links").update({ expires_at: at, updated_at: at })
    .eq("account_id", accountId).eq("checkout_session_id", sessionId);
  if (error) throw new Error(`markBillingLinkExpired failed: ${error.message}`);
}

/** One subscription item as BIS reads it: the price's own metadata names
 *  its plan and its role (PR-1's priceCreateParams sets both). */
export type SubscriptionItemSnapshot = { id: string; priceId: string; priceKey: PlanPriceKey | null; planId: string | null };

/** What BIS keeps of a Stripe subscription, re-read from Stripe on every
 *  event (never from the event payload). Times are Stripe's SECONDS. */
export type SubscriptionSnapshot = {
  id: string;
  customerId: string;
  /** Stripe's value, unvalidated: decideMirror refuses one BIS does not know. */
  status: string;
  /** metadata.bis_account_id, set by BIS's Checkout (subscription_data). */
  accountId: string | null;
  /** The BASE item's price metadata bis_plan_id (G6). */
  planId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  startedAt: number;
  items: SubscriptionItemSnapshot[];
};

export type MirrorRefusal =
  | "no_account" | "unknown_account" | "customer_changed" | "customer_mismatch" | "unknown_plan" | "plan_other_agency"
  | "another_live_subscription" | "ended_other_subscription" | "unknown_status";

type MirrorRow = {
  account_id: string; plan_id: string; complimentary: false; stripe_customer_id: string;
  stripe_subscription_id: string; subscription_status: SubscriptionStatus;
  current_period_start: string | null; current_period_end: string | null; past_due_since: string | null;
  billing_started_at: string; updated_at: string;
  /** 0099: when Stripe last confirmed this row (every write sets it). */
  stripe_checked_at: string;
  /** 0099: present (as null) only on a PAID status: payment clears the pause. */
  billing_paused_at?: null;
};

export type MirrorDecision =
  | { kind: "write"; row: MirrorRow; permissions: PlanFeatures }
  | { kind: "refused"; reason: MirrorRefusal };

export type MirrorPlan = { id: string; agencyId: string; features: PlanFeatures };

const seconds = (s: number): string => new Date(s * 1000).toISOString();

/** updated_at is the mirror's compare-and-set version (B5), so a write must
 *  never leave it where it was: at least 1 ms past the stored value, even
 *  when two writes share a millisecond or this instance's clock runs behind.
 *  (Date.parse keeps the milliseconds of PostgREST's microsecond text.) */
export function nextVersion(now: Date, stored: string | undefined): string {
  const floor = stored ? Date.parse(stored) + 1 : Number.NEGATIVE_INFINITY;
  return new Date(Math.max(now.getTime(), floor)).toISOString();
}

/**
 * PURE. The billed row a subscription snapshot becomes, or why not (G7).
 * `account`, `plan`, `existing` and `link` are what the database holds for
 * the snapshot's account; nothing here reads the event that triggered it.
 */
export function decideMirror(input: {
  snapshot: SubscriptionSnapshot;
  account: { id: string; agencyId: string } | null;
  plan: MirrorPlan | null;
  existing: AccountBilling | null;
  link: Pick<BillingLink, "stripeCustomerId"> | null;
  now: Date;
}): MirrorDecision {
  const { snapshot: s, account, plan, existing, link, now } = input;
  const refuse = (reason: MirrorRefusal): MirrorDecision => ({ kind: "refused", reason });
  if (!account) return refuse("unknown_account");
  // G3: once the billed row holds a customer, it is the account's customer
  // for good (a pending link naming another does not change that). Only an
  // account with no stored customer takes the link's.
  const storedCustomer = existing?.stripeCustomerId ?? null;
  if (storedCustomer !== null && s.customerId !== storedCustomer) return refuse("customer_changed");
  if (storedCustomer === null && link?.stripeCustomerId !== s.customerId) return refuse("customer_mismatch");
  if (!isSubscriptionStatus(s.status)) return refuse("unknown_status");
  if (!plan) return refuse("unknown_plan");
  if (plan.agencyId !== account.agencyId) return refuse("plan_other_agency");
  const sameSubscription = existing !== null && existing.stripeSubscriptionId === s.id;
  if (existing?.stripeSubscriptionId && !sameSubscription) {
    // An ended subscription OLDER than the stored one is history: a late event
    // for an old canceled subscription must not rewrite the id of a newer
    // ended one and move billing_started_at backwards. A NEWER one that has
    // already ended (paid, then incomplete_expired before its first event was
    // processed, say through a webhook outage) still replaces the older one,
    // so it consumes its link: refused, that link's completed session would
    // make every Send answer checkout_finished forever. billing_started_at is
    // the stored subscription's own start_date (set whenever the id changes).
    //
    // Tested BEFORE the live-subscription check (final review m1): whether
    // the stored one is live or ended, an old ended subscription is stale
    // history, and naming it another_live_subscription would send an operator
    // to the runbook's "cancel and refund" over a legitimate final invoice.
    if (ENDED_STATUSES.includes(s.status) && s.startedAt * 1000 < Date.parse(existing.billingStartedAt)) {
      return refuse("ended_other_subscription");
    }
    if (existing.subscriptionStatus && !ENDED_STATUSES.includes(existing.subscriptionStatus)) {
      return refuse("another_live_subscription");
    }
  }
  const unpaid = PAST_DUE_STATUSES.includes(s.status);
  const paid = PAID_STATUSES.includes(s.status);
  return {
    kind: "write",
    // Passed through: writePermissions keeps exactly the two flags, the one
    // filter every permissions write (mirror and complimentary) goes through.
    permissions: plan.features,
    row: {
      account_id: account.id, plan_id: plan.id, complimentary: false,
      stripe_customer_id: s.customerId, stripe_subscription_id: s.id, subscription_status: s.status,
      current_period_start: s.currentPeriodStart === null ? null : seconds(s.currentPeriodStart),
      current_period_end: s.currentPeriodEnd === null ? null : seconds(s.currentPeriodEnd),
      past_due_since: unpaid ? (sameSubscription && existing?.pastDueSince ? existing.pastDueSince : now.toISOString()) : null,
      billing_started_at: sameSubscription ? existing.billingStartedAt : seconds(s.startedAt),
      stripe_checked_at: now.toISOString(),
      // Payment clears the pause (spec flow 5; plan G2). Only a PAID status
      // clears it: the key is absent otherwise, so a past_due re-read never
      // un-pauses and an insert takes the column default (NULL).
      ...(paid ? { billing_paused_at: null } : {}),
      updated_at: nextVersion(now, existing?.updatedAt),
    },
  };
}

type PlanForBilling = MirrorPlan & { archivedAt: string | null };

async function readAccount(db: SupabaseClient, accountId: string): Promise<{ id: string; agencyId: string } | null> {
  const { data, error } = await db.from("accounts").select("id, agency_id").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`billing: account read failed: ${error.message}`);
  const r = data as { id: string; agency_id: string } | null;
  return r ? { id: r.id, agencyId: r.agency_id } : null;
}

async function readPlan(db: SupabaseClient, planId: string): Promise<PlanForBilling | null> {
  const { data, error } = await db.from("plans").select("id, agency_id, features, archived_at").eq("id", planId).maybeSingle();
  if (error) throw new Error(`billing: plan read failed: ${error.message}`);
  const r = data as { id: string; agency_id: string; features: PlanFeatures; archived_at: string | null } | null;
  return r ? { id: r.id, agencyId: r.agency_id, features: r.features, archivedAt: r.archived_at } : null;
}

/** accounts.permissions is reserved for plans (platform spec section 3) and
 *  nothing else writes it (G9): EXACTLY the two feature flags, or {} for an
 *  unbilled account. accounts has no updated_at column. */
async function writePermissions(db: SupabaseClient, accountId: string, features: PlanFeatures | null): Promise<void> {
  const permissions = features
    ? { voice_receptionist: features.voice_receptionist, web_concierge: features.web_concierge }
    : {};
  const { error } = await db.from("accounts").update({ permissions }).eq("id", accountId);
  if (error) throw new Error(`billing: permissions write failed: ${error.message}`);
}

export type MirrorOutcome =
  | { kind: "written"; accountId: string; planId: string; status: SubscriptionStatus }
  | { kind: "refused"; reason: MirrorRefusal };

/** How many times the mirror starts again after losing a race (B5) before
 *  it throws: the webhook then answers 500, and Stripe retries later. */
export const MIRROR_ATTEMPTS = 3;

/**
 * Stores what Stripe says NOW about one subscription as the account's billed
 * row (spec flow 4): the row (billing_paused_at is cleared on a paid status and never set here), the
 * permissions, and the link that led to it consumed (linkLedTo). `read` asks Stripe (the
 * gateway's retrieveSubscription); nothing from a webhook payload reaches
 * here. Idempotent: the same Stripe state twice writes the same row.
 *
 * COMPARE-AND-SET (B5). The stored row is read BEFORE Stripe is asked, and
 * written only while it is still that row: an update filtered on its
 * updated_at, or an insert when there was none (a 23505 on account_billing_pkey
 * is the same signal; a 23505 on any other unique key throws).
 * A delivery that read Stripe earlier but reaches the database later
 * therefore loses, reads the row and Stripe again, and writes the NEWER
 * state instead of overwriting it with an older one. A REFUSAL is returned
 * only while the row is still that row too (it is final: the event gets
 * stamped). The first read only names the account; its values are never
 * written. Throws on any database error, and after MIRROR_ATTEMPTS lost
 * races, so the webhook answers 500 and Stripe retries.
 *
 * What is guaranteed is the ROW. The permissions write and the link cleanup
 * follow it outside the compare-and-set, so two racing deliveries can leave
 * `accounts.permissions` from the older one. Harmless in PR-3 (nothing reads
 * permissions yet, G9). PR-4 (plan G4) keeps it out of enforcement: every
 * gate reads the PLAN's features through readBillingStanding, never
 * accounts.permissions, and the nightly step rewrites it (healPermissions).
 */
export async function mirrorSubscription(
  db: SupabaseClient, read: () => Promise<SubscriptionSnapshot>, now: () => Date,
): Promise<MirrorOutcome> {
  let snapshot = await read();
  for (let attempt = 1; attempt <= MIRROR_ATTEMPTS; attempt += 1) {
    const accountId = snapshot.accountId;
    if (!accountId || !UUID.test(accountId)) return { kind: "refused", reason: "no_account" };
    const existing = await getAccountBilling(db, accountId);
    snapshot = await read();
    // Its bis_account_id changed between the two reads: start over on the new one.
    if (snapshot.accountId !== accountId) continue;
    const outcome = await writeMirror(db, accountId, snapshot, existing, now());
    if (outcome !== "conflict") return outcome;
  }
  throw new Error(`mirrorSubscription: the billing row for ${snapshot.id} kept changing (${MIRROR_ATTEMPTS} attempts); Stripe will retry`);
}

/** One attempt: decide against `existing` (read before Stripe was asked),
 *  then write only if the row is still `existing`. "conflict" = it is not. */
async function writeMirror(
  db: SupabaseClient, accountId: string, snapshot: SubscriptionSnapshot, existing: AccountBilling | null, now: Date,
): Promise<MirrorOutcome | "conflict"> {
  const planId = snapshot.planId && UUID.test(snapshot.planId) ? snapshot.planId : null;
  const [account, link, plan] = await Promise.all([
    readAccount(db, accountId), getBillingLink(db, accountId), planId ? readPlan(db, planId) : Promise.resolve(null),
  ]);
  const decision = decideMirror({ snapshot, account, plan, existing, link, now });
  if (decision.kind === "refused") {
    // A refusal is FINAL (the event is stamped), so it must rest on the row as
    // it is now, not as it was before Stripe was asked. The link is read AFTER
    // the Stripe read: on a first checkout, a concurrent delivery can insert
    // the row AND consume the link in between, and this attempt then sees no
    // stored customer and no link (customer_mismatch) while the row it would
    // correct sits `incomplete`. If the row moved (or appeared, or went), it
    // is a conflict: start again on the new row.
    const current = await getAccountBilling(db, accountId);
    return (current?.updatedAt ?? null) === (existing?.updatedAt ?? null) ? decision : "conflict";
  }
  if (existing === null) {
    const { error } = await db.from("account_billing").insert(decision.row);
    // Only the primary key is the compare-and-set conflict (the row appeared).
    // A 23505 on stripe_customer_id / stripe_subscription_id is another
    // account holding that Stripe object: retrying MIRROR_ATTEMPTS times could
    // never succeed, so it throws at once, naming the key.
    if (error && uniqueViolated(error) === ACCOUNT_BILLING_PKEY) return "conflict";
    if (error) throw writeFailed("mirrorSubscription insert", error);
  } else {
    const { data, error } = await db.from("account_billing").update(decision.row)
      .eq("account_id", accountId).eq("updated_at", existing.updatedAt).select("account_id");
    if (error) throw new Error(`mirrorSubscription update failed: ${error.message}`);
    if ((data ?? []).length === 0) return "conflict";
  }
  await writePermissions(db, accountId, decision.permissions);
  if (link && linkLedTo(link, snapshot)) {
    // Keyed by the session judged above too: a link replaced meanwhile is a
    // different link, and is not this subscription's to consume.
    const { error: delErr } = await db.from("billing_links").delete()
      .eq("account_id", accountId).eq("stripe_customer_id", snapshot.customerId)
      .eq("checkout_session_id", link.checkoutSessionId);
    if (delErr) throw new Error(`mirrorSubscription link cleanup failed: ${delErr.message}`);
  }
  return { kind: "written", accountId, planId: decision.row.plan_id, status: decision.row.subscription_status };
}

/**
 * Whether `link` is the one that led to this subscription, so the mirror may
 * consume it (review item 1). A matching customer is NOT enough: after a
 * cancel, Send reuses the stored customer (G3), so an old subscription and a
 * newly sent link share it. Consuming the new link on an old subscription's
 * late event (a retry, its final metered invoice, a Smart Retries failure)
 * would hide an OPEN Checkout session from the next Send, which could then
 * open a second one: the client could pay twice (G2).
 *
 * The rule: same customer, and the subscription STARTED at or after the link
 * was SENT. sent_at is the `now` Send passes to saveBillingLink, taken when
 * the action STARTS, before any Stripe call, so it precedes the session and
 * therefore the payment; a Checkout subscription is created only when the
 * client pays. It is deliberately NOT "this write changed the stored
 * subscription id": a delivery whose row write landed but whose delete
 * failed (500, Stripe retries), or one that lost the row to a concurrent
 * delivery that then crashed, replays with the row already on this
 * subscription, and must still consume the link. The start-vs-send rule
 * gives the same answer on every replay.
 *
 * Clocks: start_date is Stripe's, in whole seconds; sent_at is BIS's own
 * timestamp (Date.parse keeps its milliseconds; the opaque-microseconds rule
 * is for updated_at in the compare-and-set filter, not this). A skew only
 * matters if the client pays within the skew of the send. A miss is NOT
 * harmless: while the subscription is live, Send refuses at G2 step 1 anyway,
 * but once it ENDS, Send reaches step 2, reads the leftover session as
 * complete and answers checkout_finished, blocking every new link for that
 * account until the row is cleared by hand. Assumes no backdated start_date:
 * BIS's Checkout never backdates.
 */
function linkLedTo(link: Pick<BillingLink, "stripeCustomerId" | "sentAt">, snapshot: SubscriptionSnapshot): boolean {
  return link.stripeCustomerId === snapshot.customerId && snapshot.startedAt * 1000 >= Date.parse(link.sentAt);
}

type PlanRefusal = "unknown_account" | "unknown_plan" | "plan_other_agency" | "plan_archived";

async function checkedPlan(
  db: SupabaseClient, accountId: string, planId: string,
): Promise<{ ok: true; plan: PlanForBilling } | { ok: false; reason: PlanRefusal }> {
  const [account, plan] = await Promise.all([readAccount(db, accountId), readPlan(db, planId)]);
  if (!account) return { ok: false, reason: "unknown_account" };
  if (!plan) return { ok: false, reason: "unknown_plan" };
  if (plan.agencyId !== account.agencyId) return { ok: false, reason: "plan_other_agency" };
  if (plan.archivedAt) return { ok: false, reason: "plan_archived" };
  return { ok: true, plan };
}

/** Complimentary (G16): on a plan, no Stripe subscription, never paused
 *  (0051's CHECK). Only for an account with NO billing row. */
export async function markComplimentary(
  db: SupabaseClient, input: { accountId: string; planId: string; now: Date },
): Promise<{ ok: true } | { ok: false; reason: PlanRefusal | "already_billed" }> {
  const checked = await checkedPlan(db, input.accountId, input.planId);
  if (!checked.ok) return checked;
  const at = input.now.toISOString();
  const { error } = await db.from("account_billing").insert({
    account_id: input.accountId, plan_id: input.planId, complimentary: true, billing_started_at: at, updated_at: at,
  });
  if (error) {
    if (uniqueViolated(error) === ACCOUNT_BILLING_PKEY) return { ok: false, reason: "already_billed" };
    throw writeFailed("markComplimentary", error);
  }
  await writePermissions(db, input.accountId, checked.plan.features);
  return { ok: true };
}

/** Back to unbilled: deletes a COMPLIMENTARY row only (never a paid one) and
 *  resets permissions to {}. False when there was no complimentary row. */
export async function unmarkComplimentary(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await db.from("account_billing").delete()
    .eq("account_id", accountId).eq("complimentary", true).select("account_id");
  if (error) throw new Error(`unmarkComplimentary failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await writePermissions(db, accountId, null);
  return true;
}

/** A complimentary account's plan change, optimistic on the plan the caller
 *  saw (a second tab's change makes this `stale`). */
export async function changeComplimentaryPlan(
  db: SupabaseClient, input: { accountId: string; planId: string; expectedPlanId: string; now: Date },
): Promise<{ ok: true } | { ok: false; reason: PlanRefusal | "stale" }> {
  const checked = await checkedPlan(db, input.accountId, input.planId);
  if (!checked.ok) return checked;
  const { data, error } = await db.from("account_billing")
    .update({ plan_id: input.planId, updated_at: input.now.toISOString() })
    .eq("account_id", input.accountId).eq("complimentary", true).eq("plan_id", input.expectedPlanId)
    .select("account_id");
  if (error) throw new Error(`changeComplimentaryPlan failed: ${error.message}`);
  if ((data ?? []).length === 0) return { ok: false, reason: "stale" };
  await writePermissions(db, input.accountId, checked.plan.features);
  return { ok: true };
}

/**
 * Records a Stripe event id once (insert ... on conflict do nothing):
 * "new" the first time, "retry" when it is stored but was never stamped (an
 * earlier attempt threw; process it again), "done" once stamped.
 */
export async function claimWebhookEvent(db: SupabaseClient, eventId: string, type: string): Promise<"new" | "retry" | "done"> {
  const { data, error } = await db.from("stripe_webhook_events")
    .upsert({ event_id: eventId, type }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");
  if (error) throw new Error(`claimWebhookEvent failed: ${error.message}`);
  if ((data ?? []).length === 1) return "new";
  const { data: row, error: readErr } = await db.from("stripe_webhook_events")
    .select("processed_at").eq("event_id", eventId).maybeSingle();
  if (readErr) throw new Error(`claimWebhookEvent read failed: ${readErr.message}`);
  if (!row) throw new Error(`claimWebhookEvent: ${eventId} neither inserted nor found`);
  return (row as { processed_at: string | null }).processed_at ? "done" : "retry";
}

export async function markWebhookEventProcessed(db: SupabaseClient, eventId: string, at: Date): Promise<void> {
  const { error } = await db.from("stripe_webhook_events")
    .update({ processed_at: at.toISOString() }).eq("event_id", eventId).is("processed_at", null);
  if (error) throw new Error(`markWebhookEventProcessed failed: ${error.message}`);
}

/* ------------------------------------------------------------------------ */
/* M7a PR-4 (0099): the non-payment pause, Lift pause, the standing read,   */
/* the agency's alerts. docs/superpowers/plans/2026-10-26-m7a-pr4-pause-    */
/* and-reconciliation.md, Task 2.                                            */
/* ------------------------------------------------------------------------ */

export type BillingStanding = {
  complimentary: boolean;
  pausedAt: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  features: PlanFeatures;
};

/**
 * What enforcement reads (plan G4, G5): the pause stamp, the status (for WHY
 * a pause is on) and the PLAN's features, in one embed read through
 * account_billing.plan_id. Never accounts.permissions, which the mirror
 * writes outside its compare-and-set (PR-3 B5). null = no row = unbilled.
 * A row always has a plan (plan_id not null, restrict), so a missing embed is
 * a read fault and throws; each caller decides what a throw means. Needs
 * serviceDb(): plans is agency-read only, and a client Staff session reads no
 * account_billing row at all (0066).
 */
export async function readBillingStanding(db: SupabaseClient, accountId: string): Promise<BillingStanding | null> {
  const { data, error } = await db.from("account_billing")
    .select("complimentary, billing_paused_at, subscription_status, plans(features)")
    .eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`billing: standing read failed: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as {
    complimentary: boolean; billing_paused_at: string | null; subscription_status: SubscriptionStatus | null;
    plans: { features: PlanFeatures } | null;
  };
  if (!r.plans) throw new Error(`billing: standing read found no plan for account ${accountId}`);
  return {
    complimentary: r.complimentary, pausedAt: r.billing_paused_at,
    subscriptionStatus: r.subscription_status, features: r.plans.features,
  };
}

const PAUSE_PAGE = 500;

/**
 * Every row the pause pass (and the nightly re-read) may act on: not
 * complimentary, with a subscription, and paused or in a status the pass
 * reads (G1). Paged by account id until an actually EMPTY page (PR-1 rule:
 * a short page is not the end when PostgREST's max_rows is below the page).
 * The complimentary filter is defence in depth: 0051's CHECKs already keep a
 * complimentary row subscription-less and unpaused.
 */
export async function listPauseCandidates(db: SupabaseClient): Promise<AccountBilling[]> {
  const out: AccountBilling[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing").select(BILLING_COLUMNS)
      .eq("complimentary", false).not("stripe_subscription_id", "is", null)
      .or("billing_paused_at.not.is.null,subscription_status.in.(past_due,unpaid,canceled)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listPauseCandidates failed: ${error.message}`);
    const rows = (data ?? []) as AccountBillingDbRow[];
    if (rows.length === 0) return out;
    out.push(...rows.map(toBilling));
    from += rows.length;
  }
}

/** Stamps the pause (the cron pass, G1). Compare-and-set on updated_at
 *  (PR-3 B5): a row the mirror or the agency changed since the pass read it
 *  is a conflict, re-decided next tick. Never on a complimentary row, never
 *  over an existing pause, and only on a row with a subscription that is
 *  unpaid or ended (review m1): the row itself refuses, so a bug in the pause
 *  decision can never pause a paying (active, trialing) or never-paid row. */
export async function pauseBilling(
  db: SupabaseClient, input: { accountId: string; expectedUpdatedAt: string; now: Date },
): Promise<"paused" | "conflict"> {
  const { data, error } = await db.from("account_billing")
    .update({ billing_paused_at: input.now.toISOString(), updated_at: nextVersion(input.now, input.expectedUpdatedAt) })
    .eq("account_id", input.accountId).eq("updated_at", input.expectedUpdatedAt)
    .eq("complimentary", false).is("billing_paused_at", null)
    .not("stripe_subscription_id", "is", null).in("subscription_status", ["past_due", "unpaid", "canceled"])
    .select("account_id");
  if (error) throw new Error(`pauseBilling failed: ${error.message}`);
  return (data ?? []).length === 1 ? "paused" : "conflict";
}

/** Clears the pause: `lift` = the agency's Lift pause (stamps
 *  pause_lifted_at, G3); otherwise the pass healing a paid row (G1/G2).
 *  Compare-and-set on updated_at, on a row that is still paused. */
export async function clearBillingPause(
  db: SupabaseClient, input: { accountId: string; expectedUpdatedAt: string; now: Date; lift: boolean },
): Promise<"cleared" | "conflict"> {
  const at = input.now.toISOString();
  const { data, error } = await db.from("account_billing")
    .update({
      billing_paused_at: null, updated_at: nextVersion(input.now, input.expectedUpdatedAt),
      ...(input.lift ? { pause_lifted_at: at } : {}),
    })
    .eq("account_id", input.accountId).eq("updated_at", input.expectedUpdatedAt)
    .not("billing_paused_at", "is", null)
    .select("account_id");
  if (error) throw new Error(`clearBillingPause failed: ${error.message}`);
  return (data ?? []).length === 1 ? "cleared" : "conflict";
}

/** Undo of a Lift (G3): re-pauses only while the row still carries THAT lift
 *  (compared as instants: PostgREST returns microseconds and +00:00), is not
 *  paused, is not complimentary, has a subscription and is still unpaid or
 *  ended. Anything else is "stale": the billing changed under the toast. It
 *  RESTORES the pause's own start (`pausedAt`, returned by the Lift), so the
 *  30-day forward clock (I7) does not restart (re-review m1). */
export async function undoLiftBillingPause(
  db: SupabaseClient, input: { accountId: string; liftedAt: string; pausedAt: string; now: Date },
): Promise<"repaused" | "stale"> {
  const pausedAtMs = Date.parse(input.pausedAt);
  if (Number.isNaN(pausedAtMs) || pausedAtMs > Date.parse(input.liftedAt)) return "stale";
  const row = await getAccountBilling(db, input.accountId);
  const sameLift = row?.pauseLiftedAt != null && Date.parse(row.pauseLiftedAt) === Date.parse(input.liftedAt);
  const status = row?.subscriptionStatus ?? null;
  const pausable = status !== null && (PAST_DUE_STATUSES.includes(status) || status === "canceled");
  if (!row || !sameLift || row.billingPausedAt || row.complimentary || !row.stripeSubscriptionId || !pausable) return "stale";
  const { data, error } = await db.from("account_billing")
    .update({ billing_paused_at: new Date(pausedAtMs).toISOString(), pause_lifted_at: null, updated_at: nextVersion(input.now, row.updatedAt) })
    .eq("account_id", input.accountId).eq("updated_at", row.updatedAt)
    .select("account_id");
  if (error) throw new Error(`undoLiftBillingPause failed: ${error.message}`);
  return (data ?? []).length === 1 ? "repaused" : "stale";
}

/** The nightly heal (G4): accounts.permissions rewritten from the row's
 *  CURRENT plan. No row = {} (unbilled). */
export async function healPermissions(db: SupabaseClient, accountId: string): Promise<void> {
  const row = await getAccountBilling(db, accountId);
  if (!row) return writePermissions(db, accountId, null);
  const plan = await readPlan(db, row.planId);
  if (!plan) throw new Error(`healPermissions: plan ${row.planId} of account ${accountId} not found`);
  await writePermissions(db, accountId, plan.features);
}

const DAY = 24 * 60 * 60 * 1000;
/** I7: from here a paused account's calls are no longer forwarded (mirrors
 *  standing.ts's PAUSE_FORWARD_MS; a test pins the two equal). */
export const PAUSE_ALERT_FORWARD_MS = 30 * DAY;
/** The 30-day item leaves the work queue two weeks later (M8). */
export const PAUSE_ALERT_END_MS = 44 * DAY;
/** A reconciliation alert is shown while its newest check is this recent. */
export const RECONCILE_ALERT_FRESH_MS = 48 * 60 * 60 * 1000;

export type BillingAlert = {
  accountId: string;
  accountName: string;
  kind: "payment_failed" | "paused" | "paused_no_forward" | "usage_mismatch";
  since: string;
};

/** listBillingAlerts' answer: the lines, and whether the reconciliation read
 *  failed (design review I3), so the banner can say it couldn't check rather
 *  than present "no mismatch" as a fact. */
export type BillingAlerts = { alerts: BillingAlert[]; reconciliationUnchecked: boolean };

/** The agency's work-queue banner (G13). Agency only: the caller has run
 *  requireAgency() and passes serviceDb(). Names come from accounts.name,
 *  the agency's own label (agency eyes only, never a client's). Every line
 *  ENDS (M8): payment_failed when the mirror clears past_due_since or the
 *  pass pauses; paused / paused_no_forward at PAUSE_ALERT_END_MS; a
 *  usage_mismatch after the next night's run or RECONCILE_ALERT_FRESH_MS. */
export async function listBillingAlerts(db: SupabaseClient, now: Date, opts: { enforced: boolean }): Promise<BillingAlerts> {
  const t = now.getTime();
  const alerts: BillingAlert[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing")
      .select("account_id, past_due_since, billing_paused_at, accounts(name)")
      .eq("complimentary", false)
      .or("billing_paused_at.not.is.null,subscription_status.in.(past_due,unpaid)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listBillingAlerts failed: ${error.message}`);
    const rows = (data ?? []) as unknown as {
      account_id: string; past_due_since: string | null; billing_paused_at: string | null; accounts: { name: string } | null;
    }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const accountName = r.accounts?.name ?? r.account_id;
      if (r.billing_paused_at) {
        const age = t - Date.parse(r.billing_paused_at);
        // m3: "calls are no longer forwarded" is true only while the switch enforces it.
        if (age < PAUSE_ALERT_FORWARD_MS || (!opts.enforced && age < PAUSE_ALERT_END_MS)) {
          alerts.push({ accountId: r.account_id, accountName, kind: "paused", since: r.billing_paused_at });
        } else if (age < PAUSE_ALERT_END_MS) {
          alerts.push({ accountId: r.account_id, accountName, kind: "paused_no_forward", since: r.billing_paused_at });
        }
      } else if (r.past_due_since) {
        alerts.push({ accountId: r.account_id, accountName, kind: "payment_failed", since: r.past_due_since });
      }
    }
    from += rows.length;
  }
  // Reconciliation: per (account, meter), the rows of its NEWEST night's run,
  // alerting, and fresh. "Its newest night" is the 08:00 UTC window
  // (reconcileNightStart) holding the key's newest check, exactly (review m3):
  // the closed-period and current-period comparisons of one night both count,
  // however late in the window the budget resumed the run, so a closed
  // period's mismatch found tonight is not hidden by tonight's matching
  // current period; a row from an earlier window is last night's news.
  // PAGED until an EMPTY page (review I: one read stops at PostgREST's
  // max_rows and silently dropped the oldest-checked alert), in a stable
  // total order: newest check first (the night logic relies on it), then the
  // key, so a page boundary between equal checked_at values is deterministic.
  // Its failure is caught HERE (design review I3, plan G13): the paused and
  // payment lines above still stand, no partial mismatch set is returned, and
  // the caller is told the check could not be made. The first read's failure
  // still throws: those lines are the banner's point.
  try {
    return { alerts: [...alerts, ...(await readMismatchAlerts(db, t))], reconciliationUnchecked: false };
  } catch (e) {
    console.error(`listBillingAlerts: ${e instanceof Error ? e.message : String(e)}; the paused and payment lines stand`);
    return { alerts, reconciliationUnchecked: true };
  }
}

async function readMismatchAlerts(db: SupabaseClient, t: number): Promise<BillingAlert[]> {
  const alerts: BillingAlert[] = [];
  const nightOf = new Map<string, number>();
  const flagged = new Set<string>();
  const freshSince = new Date(t - RECONCILE_ALERT_FRESH_MS).toISOString();
  for (let from = 0; ; ) {
    const { data, error } = await db.from("billing_reconciliations")
      .select("account_id, meter, checked_at, verdict, accounts(name)")
      .gte("checked_at", freshSince)
      .order("checked_at", { ascending: false }).order("account_id", { ascending: true })
      .order("meter", { ascending: true }).order("window_start", { ascending: true })
      .range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listBillingAlerts reconciliation read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as {
      account_id: string; meter: string; checked_at: string; verdict: string; accounts: { name: string } | null;
    }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const key = `${r.account_id}:${r.meter}`;
      const checked = Date.parse(r.checked_at);
      // The first row of a key is its newest check (checked_at descending).
      const night = nightOf.get(key) ?? reconcileNightStart(new Date(checked)).getTime();
      nightOf.set(key, night);
      if (checked < night) continue; // an earlier night's row for this key
      if (!(ALERTING_VERDICTS as readonly string[]).includes(r.verdict) || flagged.has(r.account_id)) continue;
      flagged.add(r.account_id);
      alerts.push({ accountId: r.account_id, accountName: r.accounts?.name ?? r.account_id, kind: "usage_mismatch", since: r.checked_at });
    }
    from += rows.length;
  }
  return alerts;
}

/** Live subscriptions BIS bills usage for (G14): a subscription and a
 *  customer, not ended, not complimentary. Paged until an empty page. */
export async function listReconcilableAccounts(db: SupabaseClient): Promise<AccountBilling[]> {
  const out: AccountBilling[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing").select(BILLING_COLUMNS)
      .eq("complimentary", false).not("stripe_subscription_id", "is", null).not("stripe_customer_id", "is", null)
      .not("subscription_status", "in", "(canceled,incomplete_expired)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listReconcilableAccounts failed: ${error.message}`);
    const rows = (data ?? []) as AccountBillingDbRow[];
    if (rows.length === 0) return out;
    out.push(...rows.map(toBilling));
    from += rows.length;
  }
}
