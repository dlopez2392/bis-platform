import { Webhook } from "svix";
import { serviceDb, updateMessageStatusByProviderId, recordEmailSuppression, type MessageStatus } from "@bis/db";
import { stampHeartbeat } from "@/lib/ops/stamp";
import { COMPLAINT_ERROR_MARKER } from "@/lib/email/failure-reason";

const STATUS_BY_EVENT: Record<string, MessageStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  // D-016: a spam complaint is not a plain bounce, even though both still
  // land on the one "bounced" status (0005_messaging.sql's CHECK constraint
  // has no "complained" value, and adding one is a migration — out of
  // scope here). COMPLAINT_ERROR_MARKER below is what keeps it tellable
  // apart: a hard bounce, a soft bounce and a complaint are different
  // things to do about an address. The suppression half (refusing later
  // mail) is below, in the suppression block.
  "email.complained": "bounced",
  "email.failed": "failed",
};

/** The two FK names 0054 gives consent_events, verified against a live
 *  throw on bis-ci (review item 2): `consent_events_contact_fkey` is
 *  (account_id, contact_id) -> contacts(account_id, id) — a contact that
 *  does not belong to the account being written, or does not exist at
 *  all; `consent_events_account_id_fkey` is account_id alone. */
const CONTACT_FK_NAME = "consent_events_contact_fkey";
const ACCOUNT_FK_NAME = "consent_events_account_id_fkey";

function violates(e: unknown, constraint: string): boolean {
  return e instanceof Error && e.message.includes(constraint);
}

/**
 * Review item 2: writes the suppression, retrying ONCE with no contact when
 * the pair itself is the problem — a tag or row contact deleted since, or
 * one that belongs to a different account than the one being written
 * (23503, never silently dropped). The suppression is keyed on the
 * ADDRESS (emailLedgerAddress), so a contact-less write still does its
 * job. Logs and returns — never throws — when the ACCOUNT itself does not
 * exist (an account deleted since, or a non-prod send through the same
 * Resend account whose ids were never written to this database): nothing
 * here could attribute to it, the same shape as "message not found"
 * elsewhere in this route. Any OTHER failure (a real outage) is rethrown
 * unchanged, for the caller's existing 500-and-stamp handling.
 */
async function writeSuppression(input: {
  accountId: string; contactId: string | null; address: string | null;
  reason: "hard_bounce" | "complaint"; providerMessageId: string;
}): Promise<void> {
  try {
    await recordEmailSuppression(serviceDb(), input);
  } catch (e) {
    if (violates(e, CONTACT_FK_NAME) && input.contactId !== null) {
      try {
        await recordEmailSuppression(serviceDb(), { ...input, contactId: null });
        return;
      } catch (e2) {
        if (violates(e2, ACCOUNT_FK_NAME)) {
          console.error(`resend webhook: account ${input.accountId} does not exist (${input.reason}); nothing to attribute to`);
          return;
        }
        throw e2;
      }
    }
    if (violates(e, ACCOUNT_FK_NAME)) {
      console.error(`resend webhook: account ${input.accountId} does not exist (${input.reason}); nothing to attribute to`);
      return;
    }
    throw e;
  }
}

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

  // D-016 item 2: `tags` (echoed back exactly as sent, verified against
  // Resend's docs) and `bounce.type` ("Permanent" for a hard bounce — the
  // other values, e.g. "Transient"/"Undetermined", are soft and write
  // nothing; resend.com/docs/dashboard/emails/email-bounces) are read ONLY
  // for the suppression write below; the status mapping above never touches
  // them.
  let event: {
    type?: string;
    data?: {
      email_id?: string; to?: string[];
      tags?: Record<string, string>;
      bounce?: { type?: string };
    };
  };
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
  //
  // The marker is passed ONLY for a complaint — every other event keeps the
  // original 3-argument call, so a plain bounce's `error` is left exactly
  // as it was (unset, unless some other path wrote one).
  let messageRow: { accountId: string | null; contactId: string | null };
  try {
    if (event.type === "email.complained") {
      messageRow = await updateMessageStatusByProviderId(
        serviceDb(), providerMessageId, status, { error: COMPLAINT_ERROR_MARKER },
      );
    } else {
      messageRow = await updateMessageStatusByProviderId(serviceDb(), providerMessageId, status);
    }
  } catch (e) {
    stampHeartbeat("email.resend_webhook", { ok: false, error: `status write failed: ${e instanceof Error ? e.name : typeof e}` });
    throw e;
  }

  // D-016 item 2: a HARD (Permanent) bounce or a complaint stops later mail
  // to this address (consent.ts's recordEmailSuppression, 0062) — UNLESS
  // (item 3) this was operator mail: the business owner's own address,
  // never a customer's, so the owner marking their own weekly report as
  // spam must never suppress a customer. A transient or undetermined
  // bounce writes nothing either way — only a mailbox that will never
  // accept mail again earns a stop.
  const isComplaint = event.type === "email.complained";
  const isHardBounce = event.type === "email.bounced" && event.data?.bounce?.type === "Permanent";
  if (isComplaint || isHardBounce) {
    const tags = event.data?.tags ?? {};
    // Item 2: account AND contact come from the SAME source — the tags, or
    // the row — never an account from one paired with a contact from the
    // other. A tag account with no tag contact pairs with NO contact
    // (never the row's), because the row's contact belongs to the ROW's
    // account, which may not be this event's account at all.
    const pair = tags.account_id
      ? { accountId: tags.account_id, contactId: tags.contact_id ?? null }
      : { accountId: messageRow.accountId, contactId: messageRow.contactId };
    // Item 5: a disagreement between the two sources is evidence for
    // whoever is chasing a weird attribution later, never a reason to
    // withhold a write that one source can already satisfy on its own.
    if (tags.account_id && messageRow.accountId && tags.account_id !== messageRow.accountId) {
      console.error(`resend webhook: ${event.type} for provider id ${providerMessageId} — tag account ${tags.account_id} disagrees with the message row's account ${messageRow.accountId}; writing on the tag's own pair`);
    }
    if (!pair.accountId) {
      // Neither the event's own tags nor the messages row resolve to an
      // account: nothing to attribute the stop to. Logged, not stamped as
      // an error — this is a message we have no tenant context for, the
      // same shape as "not found" above, never a reason for Resend to retry.
      console.error(`resend webhook: ${event.type} for provider id ${providerMessageId} has no attributable account (no tags, no message row)`);
    } else if (tags.class !== "operator") {
      try {
        await writeSuppression({
          accountId: pair.accountId, contactId: pair.contactId, address: event.data?.to?.[0] ?? null,
          reason: isComplaint ? "complaint" : "hard_bounce",
          providerMessageId,
        });
      } catch (e) {
        stampHeartbeat("email.resend_webhook", { ok: false, error: `suppression write failed: ${e instanceof Error ? e.name : typeof e}` });
        throw e;
      }
    }
  }

  stampHeartbeat("email.resend_webhook", { ok: true });
  return new Response("ok", { status: 200 });
}
