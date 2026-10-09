"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  getContact, ensureConversation, createMessage, updateMessageStatus,
  clearUnreadCount, serviceDb, isAccountOutboundSuppressed,
} from "@bis/db";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { outboundEmail } from "@/lib/email/templates/outbound";
import { sendSms } from "@/lib/consent/gate";
import { composerBlockedLine } from "@/lib/consent/composer-state";
import { recordUsageSafely } from "@/lib/billing/usage";
import { m } from "@/lib/messages";
// A prefix on `.message` rather than an Error subclass: thrown Errors are
// serialized across the server-action boundary and do not keep a custom
// prototype chain on the way back to the client. Lives in its own module
// because a "use server" file may only export async functions.
import { sendRejected as rejectSend } from "./send-errors";

/**
 * Review fix. A real browser's form-data-set algorithm normalizes a
 * textarea's line breaks to CRLF when a `<form>` submits (the HTML spec's
 * own rule for constructing the entry list) — the operator only ever typed
 * (and the live segment counter message-composer.tsx renders only ever
 * saw) a bare `\n`, but `formData.get("body")` in THIS action sees `\r\n`.
 * Two things went wrong with that un-normalized value reaching sendEmail/
 * sendSms unchanged: `outboundEmail`'s html conversion
 * (`body.replace(/\n/g, "<br />")`) only matches the `\n` half, leaving a
 * stray `\r` in front of every line break in the html part; and SMS's
 * segments.ts counts `\r` as its own GSM-7 septet, so a line break cost TWO
 * septets instead of one — enough to silently bill a second segment on a
 * text the operator's own counter showed fitting in one. Normalized once,
 * here, before either body reaches anything that counts or sends it.
 */
function normalizeLineBreaks(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

export async function sendEmailAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = normalizeLineBreaks(String(formData.get("body") ?? "")).trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) rejectSend("contact not in account");
  if (!contact.email) rejectSend("contact has no email address");

  // 0053: conversations and messages are written by server code only. The
  // read above ran as the signed-in user under RLS, so `contact` is known to
  // belong to THIS account; that is what authorises the writes below, which
  // go through the service client scoped to the same accountId.
  const writer = serviceDb();

  // D-061, review follow-up: checked here, before anything is written — the
  // same bar sendSmsAction already sets below (its own write only happens
  // once the gate clears). Without this, sendEmailOrThrow's own chokepoint
  // check still blocks the send, but only AFTER createMessage already left a
  // `failed` row with the gate's raw reason string sitting in the thread. A
  // read that fails is treated as suppressed (fail closed), never as "go
  // ahead and write."
  let suppressed: boolean;
  try {
    suppressed = await isAccountOutboundSuppressed(writer, accountId);
  } catch (e) {
    console.error(`sendEmailAction: suppression flag unreadable for account ${accountId}: ${String(e)}`);
    suppressed = true;
  }
  if (suppressed) rejectSend(m["automations.reason.accountSuppressed"]);

  const convo = await ensureConversation(writer, accountId, contactId, userId);

  // Write-then-send: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message rather than a silent gap.
  const { id: messageId } = await createMessage(writer, accountId, {
    conversationId: convo.id, channel: "email", direction: "outbound",
    subject: subject || undefined, body,
  }, userId);

  // One row, three jobs: the display name, the reply-to, and everything the
  // template needs to wear the company's brand. getBranding() here would be a
  // second round trip to a row this query already returns. `name` is NOT
  // selected: that column is the agency's internal label and `emailBrand` has
  // no parameter left to receive it.
  const { data: account } = await db.from("accounts")
    .select("reply_to_email, from_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();

  const brand = emailBrand({
    brandName: account?.brand_name ?? null,
    brandLogoPath: account?.brand_logo_path ?? null,
    brandColor: account?.brand_color ?? null,
    brandNeutral: account?.brand_neutral ?? null,
    brandCorners: account?.brand_corners ?? null,
    brandType: account?.brand_type ?? null,
    brandMode: account?.brand_mode ?? null,
    replyToEmail: account?.reply_to_email ?? null,
  });

  const { html, text } = outboundEmail({ brand, body });

  // Only the send itself is guarded: once send() has succeeded the email is
  // gone and irrevocably out the door, so a failure recording that (a rare
  // DB error) must never be re-labeled "failed" here — that would tell the
  // operator a delivered email didn't go out, and drop the provider message
  // id the delivery webhook needs to correlate against.
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sendEmailOrThrow({
      // A person's own reply (choice 22): the gate does not read the ledger
      // for it, and — (decision Q4) — it carries no unsubscribe footer. The composer
      // shows the notice when they unsubscribed (Task 12).
      accountId, kind: "staff.composer_email", contactId,
      to: contact.email,
      // The BRAND name. `accounts.name` is the agency's internal label for this
      // company ("Rio Roofing — trial") and was reaching the customer's From
      // line on every message.
      fromName: brand.name,
      // The client's own domain, when they have one. Undefined falls back to
      // EMAIL_FROM inside the provider, which is every account until the agency
      // sets one — and stays the behaviour for the lead alert always (spec §3).
      fromAddress: account?.from_email ?? undefined,
      subject: subject || "(no subject)",
      body: text,
      html,
      // Where the customer's reply lands, and it depends on the line above.
      // Unset, the reply follows the From address: the BIS mailbox while this
      // account still sends from crm@bis-rgv.com, and the client's own
      // sending domain once from_email is set — which for the send-only
      // subdomain we recommend usually has no mailbox at all. Either way the
      // company that wrote to them never sees it. Unset omits the header,
      // which is what every account does until someone fills the field in.
      replyTo: normalizeReplyTo(account?.reply_to_email),
      // D-016 item 3: the gate now reads the suppression ledger for this
      // kind too (staff_typed, so decision 7's ledger read still skips it).
      // The service client is already in scope for 0053's own writes above.
    }, { db: writer }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    await updateMessageStatus(writer, accountId, messageId, "failed", { error: message }, userId);
    // The failed row must be visible without a manual reload — the toast
    // that follows this throw says exactly that.
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    throw e;
  }

  await updateMessageStatus(writer, accountId, messageId, "sent", { providerMessageId }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}

export async function sendSmsAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const body = normalizeLineBreaks(String(formData.get("body") ?? "")).trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  // The contact is read as the signed-in user under RLS: that read is what
  // proves the contact belongs to THIS account, and it authorises the
  // service-client writes below (0053).
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) rejectSend("contact not in account");

  // Since 0053, conversations and messages are written by server code only,
  // in the service-after-requireAccountAccess shape. Built here, before any
  // row exists, so a missing service key refuses the whole send rather than
  // letting the text out with nothing recorded.
  const writer = serviceDb();

  // THE SEND GATE (consent chain PR-1, kind `staff.composer_sms`): the A2P
  // sender, the ledger (a stopped or held number), the number's country, and
  // no hours — a person replying in a thread may do so at any hour. It
  // decides BEFORE `prepare` writes the conversation and the message row,
  // so a refused text leaves nothing in the thread; the composer already
  // shows the same reason on render (composer-state.ts), so reaching a
  // refusal here means a stale tab. Every refusal maps to operator copy,
  // never a raw reason code.
  const row: { conversationId: string | null; messageId: string | null } = { conversationId: null, messageId: null };
  const result = await sendSms(writer, {
    accountId, kind: "staff.composer_sms", to: contact.phone, body, contactId,
  }, {
    prepare: async ({ body: sentBody }) => {
      const convo = await ensureConversation(writer, accountId, contactId, userId);
      row.conversationId = convo.id;
      // WRITE THEN SEND: the row exists before anything leaves the building,
      // so a provider failure is a visible `failed` message, not a gap.
      row.messageId = (await createMessage(writer, accountId, {
        conversationId: convo.id, channel: "sms", direction: "outbound", body: sentBody,
      }, userId)).id;
    },
  });

  if (result.kind === "blocked") {
    switch (result.reason) {
      case "a2p_not_approved": rejectSend(m["compose.smsBlockedA2p"]);
      case "no_live_number": rejectSend(m["compose.smsBlockedNoNumber"]);
      case "no_number": rejectSend(m["compose.noPhoneOnContact"]);
      // The render's own words for an unreadable state (review R3-M2): never
      // worded as the customer's choice, and never an open form.
      case "ledger_unavailable": rejectSend(m["compose.smsStateUnknown"]);
      // D-061: a suppressed account (a demo, or otherwise not real) refuses
      // every send — the composer says so plainly rather than silently
      // dropping the attempt, and nothing was written: `prepare` runs only
      // after the gate clears.
      case "suppressed_account": rejectSend(m["automations.reason.accountSuppressed"]);
      default: rejectSend(composerBlockedLine(result.reason));
    }
  }
  if (result.kind === "deferred") throw new Error("a staff text was deferred, which its kind never is");
  if (result.kind === "failed") {
    // A provider refusal after the row was written: mark it failed so the
    // thread shows it, then throw so the toast says it failed.
    if (row.messageId) {
      await updateMessageStatus(writer, accountId, row.messageId, "failed", { error: result.error }, userId);
    }
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    // In PR-1 the ledger learns of a STOP from the carrier's refusal (40300),
    // so the FIRST attempt to a stopped number lands here, not as blocked:
    // say the stopped line now, not on the retry (review R3-I3). The gate
    // has already recorded the stop.
    if (result.carrierBlocked) rejectSend(composerBlockedLine("stopped"));
    throw new Error(result.error);
  }
  const messageId = row.messageId;
  if (messageId === null) throw new Error("the gate sent without writing the message row");

  // The `sent` write FIRST, straight after the send: it stores the provider
  // id the delivery webhook correlates against. It is allowed to throw (the
  // action rejects), so the usage write sits in its `finally`, where a
  // delivered text still bills (on the service client: 0051 lets only
  // service_role write usage_events).
  try {
    await updateMessageStatus(writer, accountId, messageId, "sent", { providerMessageId: result.providerMessageId }, userId);
  } finally {
    if (result.billable) {
      await recordUsageSafely(writer, {
        accountId, meter: "sms", quantity: result.segments,
        occurredAt: new Date(), sourceRef: `message:${messageId}`,
      }, `sendSmsAction ${messageId}`);
    }
  }

  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
}

export async function markConversationReadAction(
  accountId: string, conversationId: string,
): Promise<void> {
  await requireAccountAccess(accountId);
  // 0053: conversations are server-written. clearUnreadCount matches on
  // account_id AND id, and accountId is the one requireAccountAccess just
  // authorised, so another account's conversation id matches no row
  // (messaging.test.ts pins that with two real accounts).
  await clearUnreadCount(serviceDb(), accountId, conversationId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}
