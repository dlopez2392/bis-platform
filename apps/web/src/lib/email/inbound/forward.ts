import type { InboundEmailRow, SupabaseClient } from "@bis/db";
import type { EmailRequest, EmailSendResult } from "@/lib/consent/email-gate";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/**
 * The owner's copy of a filed reply (spec Inbound step 8; decision 6): from the same sender as lead
 * alerts (no fromAddress: the platform's EMAIL_FROM), operator class, so a customer's suppression
 * never blocks it. THROWS when the gate did not send it; the pipeline logs that and the filed message
 * stands.
 */
export type ForwardDeps = { db: SupabaseClient; send: (r: EmailRequest) => Promise<EmailSendResult>; origin: string | null };

export async function forwardToOwner(
  deps: ForwardDeps, f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number },
): Promise<void> {
  const { data, error } = await deps.db.from("accounts").select("reply_to_email, brand_name, name, language").eq("id", f.row.accountId).maybeSingle();
  if (error) throw new Error(`forward: account read failed: ${error.message}`);
  const a = data as { reply_to_email: string | null; brand_name: string | null; name: string; language: string | null } | null;
  const to = a?.reply_to_email?.trim();
  if (!to) return;
  const lang = a?.language === "es" ? "es" : "en";
  const business = a?.brand_name?.trim() || a?.name || "";
  const customer = f.senderName?.trim() || f.row.fromEmail;
  const lines = [f.row.text];
  if (f.attachmentCount === 1) lines.push(t(m, "email.replyForward.attachmentsOne", lang));
  else if (f.attachmentCount > 1) lines.push(t(m, "email.replyForward.attachments", lang, { count: f.attachmentCount }));
  if (deps.origin) lines.push(`${t(m, "email.replyForward.answer", lang)}: ${deps.origin}/dashboard/accounts/${f.row.accountId}/conversations?c=${f.row.conversationId}`);
  const r = await deps.send({
    accountId: f.row.accountId, kind: "operator.reply_forward", to,
    fromName: t(m, "email.replyForward.fromName", lang, { customer, business }),
    replyTo: f.row.fromEmail, subject: f.row.subject ?? "", body: lines.filter(Boolean).join("\n\n"),
  });
  if (r.kind !== "sent") throw new Error(`forward not sent: ${r.kind === "blocked" ? r.reason : r.kind}`);
}
