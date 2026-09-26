import { serviceDb } from "@bis/db";
import {
  billingGatewayFromEnv, verifyWebhookEvent, type StripeEnv, type VerifiedWebhookEvent,
} from "@/lib/billing/stripe-gateway";
import { processStripeEvent } from "@/lib/billing/webhook";

/**
 * Stripe's webhook (spec flow 4). PUBLIC: proxy.ts protects /dashboard only,
 * and the signature is the whole of the authentication. The pipeline is
 * plan G4: secret → signature over the RAW body → a usable key → mode →
 * claim once → re-read → mirror → stamp. Status codes, for Stripe's retry
 * logic: 2xx = done (processed, duplicate, ignored, refused). 400 = refused
 * (forged, or the wrong mode). Stripe retries EVERY non-2xx, a 400 too, and
 * each retry is refused the same way and recorded nowhere, which is
 * harmless. 5xx = retry later (not configured, key refused, or a failure
 * mid-way; the event stays unstamped and the retry reprocesses it).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    console.error("stripe webhook: STRIPE_WEBHOOK_SECRET is not set; answering 503 so Stripe retries");
    return new Response("not configured", { status: 503 });
  }

  // The exact text Stripe signed. Never parse and re-serialise before
  // verifying: a parse changes whitespace and key order, and the signature
  // is over the bytes.
  const payload = await request.text();
  let event: VerifiedWebhookEvent;
  try {
    event = verifyWebhookEvent(payload, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    // Unverified payloads are never read. This is the security boundary.
    return new Response("invalid signature", { status: 400 });
  }

  const gateway = billingGatewayFromEnv(process.env as StripeEnv);
  if (!gateway.ok) {
    console.error(`stripe webhook: Stripe key refused here (${gateway.reason}); answering 503 so Stripe retries`);
    return new Response("stripe unavailable", { status: 503 });
  }

  try {
    const outcome = await processStripeEvent(
      { db: serviceDb(), gateway: gateway.gateway, live: gateway.live, now: () => new Date() }, event,
    );
    if (outcome.status === "mode_mismatch") return new Response("wrong mode", { status: 400 });
    return Response.json({ received: true, outcome: outcome.status });
  } catch (e) {
    console.error(`stripe webhook: ${event.type} ${event.id} failed; Stripe will retry: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("processing failed", { status: 500 });
  }
}
