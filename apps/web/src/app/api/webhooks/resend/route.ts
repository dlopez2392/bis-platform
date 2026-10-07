import { Webhook } from "svix";
import { serviceDb, updateMessageStatusByProviderId, type MessageStatus } from "@bis/db";
import { stampHeartbeat } from "@/lib/ops/stamp";

const STATUS_BY_EVENT: Record<string, MessageStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "bounced",
  "email.failed": "failed",
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Every delivery fails while this is unset: an outage, so it is stamped.
    stampHeartbeat("email.resend_webhook", { ok: false, error: "RESEND_WEBHOOK_SECRET is not set" });
    return new Response("not configured", { status: 500 });
  }

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = new Webhook(secret).verify(payload, headers) as typeof event;
  } catch {
    // Unverified payloads are never read. This is the security boundary.
    // Not stamped: a forgery is a stranger, not an outage (lib/ops/stamp.ts).
    return new Response("invalid signature", { status: 400 });
  }

  const status = event.type ? STATUS_BY_EVENT[event.type] : undefined;
  const providerMessageId = event.data?.email_id;
  if (!status || !providerMessageId) {
    // Unmapped event or malformed payload: acknowledge so the provider stops
    // retrying something we will never act on. Signed by Resend, so the
    // route is working.
    stampHeartbeat("email.resend_webhook", { ok: true });
    return new Response("ignored", { status: 200 });
  }

  // Not found is also a 200 — a message we do not have is not an error the
  // provider can fix by retrying. A throw is a 500 Resend retries, and an
  // error heartbeat: the error's type only, since a message can quote data.
  try {
    await updateMessageStatusByProviderId(serviceDb(), providerMessageId, status);
  } catch (e) {
    stampHeartbeat("email.resend_webhook", { ok: false, error: `status write failed: ${e instanceof Error ? e.name : typeof e}` });
    throw e;
  }
  stampHeartbeat("email.resend_webhook", { ok: true });
  return new Response("ok", { status: 200 });
}
