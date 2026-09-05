"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  getContact, ensureConversation, createMessage, updateMessageStatus,
  clearUnreadCount,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { outboundEmail } from "@/lib/email/templates/outbound";
import { resolveSmsSender } from "@/lib/sms/sender";
import { getSmsProvider } from "@/lib/sms";
import { toE164 } from "@/lib/voice/phone-number";
import { m } from "@/lib/messages";
// A prefix on `.message` rather than an Error subclass: thrown Errors are
// serialized across the server-action boundary and do not keep a custom
// prototype chain on the way back to the client. Lives in its own module
// because a "use server" file may only export async functions.
import { sendRejected as rejectSend } from "./send-errors";

export async function sendEmailAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) rejectSend("contact not in account");
  if (!contact.email) rejectSend("contact has no email address");

  const convo = await ensureConversation(db, accountId, contactId, userId);

  // Write-then-send: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message rather than a silent gap.
  const { id: messageId } = await createMessage(db, accountId, {
    conversationId: convo.id, channel: "email", direction: "outbound",
    subject: subject || undefined, body,
  }, userId);

  // One row, three jobs: the display name, the reply-to, and everything the
  // template needs to wear the company's brand. getBranding() here would be a
  // second round trip to a row this query already returns.
  const { data: account } = await db.from("accounts")
    .select("name, reply_to_email, from_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
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
  }, account?.name ?? "BIS");

  const { html, text } = outboundEmail({ brand, body });

  // Only the send itself is guarded: once send() has succeeded the email is
  // gone and irrevocably out the door, so a failure recording that (a rare
  // DB error) must never be re-labeled "failed" here — that would tell the
  // operator a delivered email didn't go out, and drop the provider message
  // id the delivery webhook needs to correlate against.
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await getEmailProvider().send({
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
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    await updateMessageStatus(db, accountId, messageId, "failed", { error: message }, userId);
    // The failed row must be visible without a manual reload — the toast
    // that follows this throw says exactly that.
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    throw e;
  }

  await updateMessageStatus(db, accountId, messageId, "sent", { providerMessageId }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}

export async function sendSmsAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  // dbForRequest(), not serviceDb(): every read this action needs is already
  // granted to `authenticated` under RLS. 0013 only column-scoped UPDATE on
  // accounts (0023's a2p_* columns were never added to that grant list, on
  // purpose — an agency-only write, done elsewhere via serviceDb()), and
  // never touched SELECT; 0019/0020 grant `authenticated` SELECT on
  // phone_numbers with a tenant-scoped RLS policy. Both reads resolveSmsSender
  // makes are covered, so this stays on the RLS-enforced client like
  // sendEmailAction above, per lib/db.ts's own rule against serviceDb() on
  // the in-account surface.
  const db = await dbForRequest();

  // THE gate, and the only one. Never re-derive this.
  //
  // The refusal is mapped to operator copy, NOT passed through raw: the
  // composer already renders the reason server-side, so reaching here means a
  // stale tab or a tampered post, and "a2p_not_approved" is not a sentence a
  // business owner should ever see on their screen.
  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) {
    rejectSend(gate.reason === "a2p_not_approved"
      ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]);
  }

  const contact = await getContact(db, accountId, contactId);
  if (!contact) rejectSend("contact not in account");
  // contacts.phone is free-form (only trimmed on write) — operator-typed and
  // web-form contacts routinely arrive as "9562921696" or "(956) 292-1696".
  // toE164 (lib/voice/phone-number.ts) is live-verified: Telnyx rejects every
  // shape except "+19562921696", and every number leaving this app is
  // required to go through it. A null here means the contact has nothing we
  // can actually text, not just that the field is empty.
  const to = toE164(contact.phone);
  if (!to) rejectSend(m["compose.noPhoneOnContact"]);

  const convo = await ensureConversation(db, accountId, contactId, userId);

  // WRITE THEN SEND: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message rather than a silent gap.
  // Same ordering as sendEmailAction, same reason.
  const { id: messageId } = await createMessage(db, accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body,
  }, userId);

  // Only the send itself is guarded: once send() has succeeded the text is
  // gone and irrevocably out the door, so a failure recording that (a rare
  // DB error) must never be re-labeled "failed" here — that would tell the
  // operator a delivered text didn't go out, invite a duplicate send to a
  // real phone, and drop the provider message id the delivery webhook needs
  // to correlate against. Same hazard, same fix, as sendEmailAction above.
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await getSmsProvider().send({ to, from: gate.from, body }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    await updateMessageStatus(db, accountId, messageId, "failed", { error: message }, userId);
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    throw e;
  }

  await updateMessageStatus(db, accountId, messageId, "sent", { providerMessageId }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
}

export async function markConversationReadAction(
  accountId: string, conversationId: string,
): Promise<void> {
  await requireAccountAccess(accountId);
  await clearUnreadCount(await dbForRequest(), accountId, conversationId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}
