import {
  claimWebhookEvent, markWebhookEventProcessed, mirrorSubscription, type MirrorRefusal, type SupabaseClient,
} from "@bis/db";
import type { BillingGateway, VerifiedWebhookEvent } from "./stripe-gateway";

export type WebhookOutcome =
  | { status: "processed"; accountId: string }
  | { status: "ignored" }
  | { status: "duplicate" }
  | { status: "refused"; reason: MirrorRefusal }
  | { status: "mode_mismatch" };

export type WebhookDeps = { db: SupabaseClient; gateway: BillingGateway; live: boolean; now: () => Date };

/**
 * One verified Stripe event (spec flow 4, plan G4):
 *   wrong mode (a test event at a live key, or the reverse) → not recorded
 *   (the route answers 400; Stripe retries every non-2xx, this one too, and
 *   each retry is refused the same way, recording nothing);
 *   claim the id once → "done" means a duplicate, nothing else happens;
 *   no subscription to follow → stamp, ignore;
 *   otherwise the mirror RE-READS the subscription from Stripe (it is handed
 *   the reader, never the event's payload, so duplicates and out-of-order
 *   events converge; and it reads the stored row first and writes only if
 *   it is unchanged, so concurrent deliveries do too: B5), then stamp. A
 *   refusal is stamped too (retrying cannot fix it) and logged.
 * Anything that throws leaves the event unstamped: the route answers 500,
 * Stripe retries, and the next attempt claims it as "retry".
 *
 * NOTHING on this path may SEND anything (email, SMS, an alert). The claim
 * has no in-progress state: a second delivery of the same event that
 * arrives while the first is still running claims "retry" and runs in
 * parallel with it, so a send here could go out twice. Every write here is
 * idempotent for the same reason.
 */
export async function processStripeEvent(deps: WebhookDeps, event: VerifiedWebhookEvent): Promise<WebhookOutcome> {
  if (event.livemode !== deps.live) {
    console.error(`stripe webhook: ${event.type} ${event.id} is ${event.livemode ? "live" : "test"} mode but this deployment's key is not; not recorded`);
    return { status: "mode_mismatch" };
  }
  const claim = await claimWebhookEvent(deps.db, event.id, event.type);
  if (claim === "done") return { status: "duplicate" };
  const subscriptionId = event.subscriptionId;
  if (!subscriptionId) {
    await markWebhookEventProcessed(deps.db, event.id, deps.now());
    return { status: "ignored" };
  }
  const outcome = await mirrorSubscription(deps.db, () => deps.gateway.retrieveSubscription(subscriptionId), deps.now);
  await markWebhookEventProcessed(deps.db, event.id, deps.now());
  if (outcome.kind === "refused") {
    console.error(`stripe webhook: ${event.type} ${event.id} for subscription ${subscriptionId} refused: ${outcome.reason}`);
    return { status: "refused", reason: outcome.reason };
  }
  return { status: "processed", accountId: outcome.accountId };
}
