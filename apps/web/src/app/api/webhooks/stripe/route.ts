import { serviceDb } from "@bis/db";
import {
  billingGatewayFromEnv, isSignatureError, verifyWebhookEvent, webhookSecretFromEnv, type StripeEnv,
  type VerifiedWebhookEvent,
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
/**
 * A bound set by the PLATFORM, not a promise the run fits in it: the worst
 * case is about four Stripe reads (the mirror's first read plus one per
 * MIRROR_ATTEMPTS), each up to ~61 s under the client's 2 retries × 20 s
 * timeout. A run cut off here is safe: every step before the stamp is
 * idempotent, the event stays unstamped, Stripe sees a failure and retries,
 * and the retry redoes it.
 */
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  // The same trimmed reading the Billing card and Send use, so "set" means
  // one thing everywhere (final review I1).
  const secret = webhookSecretFromEnv();
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
  } catch (e) {
    if (isSignatureError(e)) {
      // Unverified payloads are never read. This is the security boundary.
      // One fixed line, never the header or the body: a wrong or rotated
      // secret 400s EVERY event (Stripe retries each for days), and without
      // this line nothing would say so.
      console.error("stripe webhook: signature did not verify (a wrong STRIPE_WEBHOOK_SECRET, or a forgery); answering 400");
      return new Response("invalid signature", { status: 400 });
    }
    // Signed by Stripe, but BIS could not read it (not JSON, or a shape the
    // reduction does not expect). A 500, so Stripe retries and the fault
    // stays visible. A SyntaxError's message quotes the body, which can hold
    // a customer's details, so it is named by its type only.
    const why = e instanceof SyntaxError ? "SyntaxError (the body is not JSON)"
      : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`stripe webhook: verified but unreadable: ${why}`);
    return new Response("unreadable event", { status: 500 });
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
