import { after } from "next/server";

/**
 * The webhook routes' heartbeat keys (operational-floor spec §1). The alert
 * pass reads a key as failing while its last error is newer than its last
 * success (`lib/ops/watch.ts`), so a route stamps:
 *
 *   - ok    — a request it ACCEPTED: the signature verified (or the route has
 *             no signing configured yet) and the work it exists for was done.
 *   - error — the route cannot do its job for anyone: its secret is missing,
 *             or the work failed after the request was accepted.
 *
 * NEVER on a refused signature. A forged request is a stranger, not an
 * outage, and stamping it would let anyone on the internet send BIS an
 * alert email by posting junk at a public URL.
 */
export type WebhookHeartbeatKey =
  | "voice.texml"
  | "voice.sip_webhook"
  | "email.resend_webhook"
  | "sms.inbound"
  | "stripe.webhook";

export type HeartbeatOutcome = { ok: true } | { ok: false; error: string };

/**
 * Stamps a heartbeat AFTER the response is sent, and never fails the caller.
 *
 * `after()` because two of these routes answer a carrier on a hard deadline
 * (Telnyx's TeXML fetch, OpenAI's SIP webhook) and wall-clock is the one
 * thing they cannot spend; the others use it too so every route stamps the
 * same way. The DB import is lazy for the reason the voice routes give: a
 * module-scope `@bis/db` import breaks `next build` during page-data
 * collection.
 *
 * Both failure paths are caught: `after()` has synchronous throw paths of its
 * own (no request scope), distinct from the callback rejecting, and an
 * uncaught one would escape into the route and turn a good answer into a 500.
 * `recordHeartbeat` itself never throws, but the import can.
 *
 * Route tests mock THIS module and assert its calls, so the `after()`
 * recorders they already pin keep counting only the route's own work.
 */
export function stampHeartbeat(key: WebhookHeartbeatKey, outcome: HeartbeatOutcome): void {
  try {
    after(async () => {
      try {
        const { serviceDb, recordHeartbeat } = await import("@bis/db");
        await recordHeartbeat(serviceDb(), key, outcome);
      } catch (e) {
        console.error(`heartbeat ${key}: write failed: ${String(e)}`);
      }
    });
  } catch (e) {
    console.error(`heartbeat ${key}: could not schedule: ${String(e)}`);
  }
}
