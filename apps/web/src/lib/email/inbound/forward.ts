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

// Fix round 1 (review item 1): resend.ts composes the From header as a raw
// string (`"${fromName}" <address>`) — a control character (CR/LF above
// all) or a stray quote/angle bracket in fromName is a header-injection
// payload, not a name. address.ts's displayName now refuses control
// characters at the source, but forward.ts strips them again itself,
// belt-and-braces: this function's inputs (senderName, the account's own
// brand_name) do not all necessarily pass through displayName.
function sanitizeDisplayPart(raw: string): string {
  return raw.replace(/[\x00-\x1F\x7F"<>]/g, "").trim();
}

// Fix round 1 (review item 4): a closed, fixed vocabulary — never the
// provider's own error text (EmailSendResult's `error`/`until`), which can
// carry an address or a sealed token — so a caller that logs this message
// (pipeline.ts) can never leak one.
function forwardFailureReason(r: Exclude<EmailSendResult, { kind: "sent" }>): string {
  if (r.kind === "blocked") return r.reason;
  if (r.kind === "deferred") return "deferred";
  return r.stage === "provider" ? "provider_failed" : "provider_unavailable";
}

export async function forwardToOwner(
  deps: ForwardDeps, f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number },
): Promise<void> {
  const { data, error } = await deps.db.from("accounts").select("reply_to_email, brand_name, name, language").eq("id", f.row.accountId).maybeSingle();
  if (error) throw new Error(`forward: account read failed: ${error.message}`);
  const a = data as { reply_to_email: string | null; brand_name: string | null; name: string; language: string | null } | null;
  const to = a?.reply_to_email?.trim();
  if (!to) return;
  const lang = a?.language === "es" ? "es" : "en";
  // Fix round 1 (review item 2): accounts.name is the agency's own internal
  // label (clerk-org-name.ts, shell.ts's "THERE IS NO FALLBACK") and must
  // never reach the business owner. No brand_name means no "via <business>"
  // at all — just the customer's own name/address.
  const business = sanitizeDisplayPart(a?.brand_name?.trim() ?? "");
  const customer = sanitizeDisplayPart(f.senderName?.trim() || f.row.fromEmail);
  const lines = [f.row.text];
  if (f.attachmentCount === 1) lines.push(t(m, "email.replyForward.attachmentsOne", lang));
  else if (f.attachmentCount > 1) lines.push(t(m, "email.replyForward.attachments", lang, { count: f.attachmentCount }));
  if (deps.origin) lines.push(`${t(m, "email.replyForward.answer", lang)}: ${deps.origin}/dashboard/accounts/${f.row.accountId}/conversations?c=${f.row.conversationId}`);
  const r = await deps.send({
    accountId: f.row.accountId, kind: "operator.reply_forward", to,
    fromName: business ? t(m, "email.replyForward.fromName", lang, { customer, business }) : customer,
    replyTo: f.row.fromEmail, subject: f.row.subject ?? "", body: lines.filter(Boolean).join("\n\n"),
  });
  if (r.kind !== "sent") throw new Error(`forward: ${forwardFailureReason(r)}`);
}
