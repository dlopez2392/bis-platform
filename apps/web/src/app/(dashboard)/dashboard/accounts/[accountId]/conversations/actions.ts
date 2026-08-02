"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  getContact, ensureConversation, createMessage, updateMessageStatus,
  clearUnreadCount,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
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

  const { data: account } = await db.from("accounts").select("name").eq("id", accountId).maybeSingle();

  // Only the send itself is guarded: once send() has succeeded the email is
  // gone and irrevocably out the door, so a failure recording that (a rare
  // DB error) must never be re-labeled "failed" here — that would tell the
  // operator a delivered email didn't go out, and drop the provider message
  // id the delivery webhook needs to correlate against.
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await getEmailProvider().send({
      to: contact.email,
      fromName: account?.name ?? "BIS",
      subject: subject || "(no subject)",
      body,
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

export async function markConversationReadAction(
  accountId: string, conversationId: string,
): Promise<void> {
  await requireAccountAccess(accountId);
  await clearUnreadCount(await dbForRequest(), accountId, conversationId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}
