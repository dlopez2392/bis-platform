"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import {
  serviceDb, getContact, ensureConversation, createMessage, updateMessageStatus,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";

export async function sendEmailAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const contactId = String(formData.get("contactId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || !body) throw new Error("contactId and body required");

  const db = serviceDb();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) throw new Error("contact not in account");
  if (!contact.email) throw new Error("contact has no email address");

  const convo = await ensureConversation(db, accountId, contactId, userId);

  // Write-then-send: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message rather than a silent gap.
  const { id: messageId } = await createMessage(db, accountId, {
    conversationId: convo.id, channel: "email", direction: "outbound",
    subject: subject || undefined, body,
  }, userId);

  const { data: account } = await db.from("accounts").select("name").eq("id", accountId).maybeSingle();

  try {
    const { providerMessageId } = await getEmailProvider().send({
      to: contact.email,
      fromName: account?.name ?? "BIS",
      subject: subject || "(no subject)",
      body,
    });
    await updateMessageStatus(db, accountId, messageId, "sent", { providerMessageId }, userId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    await updateMessageStatus(db, accountId, messageId, "failed", { error: message }, userId);
    throw e;
  }

  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}
