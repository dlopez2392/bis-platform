"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { callerCanSee } from "@/lib/auth/visible";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import { dbForRequest } from "@/lib/db";
import {
  getContact, ensureConversation, createMessage, updateMessageStatus,
  clearUnreadCount, serviceDb, isAccountOutboundSuppressed,
  moveHoldingThread, type HoldingMove,
} from "@bis/db";
import { contactDisplayName } from "@/lib/format";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { outboundEmail } from "@/lib/email/templates/outbound";
import { sendSms } from "@/lib/consent/gate";
import { composerBlockedLine } from "@/lib/consent/composer-state";
import { recordUsageSafely } from "@/lib/billing/usage";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { requestLocale } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
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
  const { userId, isAgency } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = normalizeLineBreaks(String(formData.get("body") ?? "")).trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) rejectSend("contact not in account");
  if (!contact.email) rejectSend("contact has no email address");

  // One row, three jobs: the display name, the reply-to, and everything the
  // template needs to wear the company's brand, PLUS (minors-1b item 1) the
  // account's own language — the one fallback a client-role sender's own
  // locale reads when they have not set a language of their own.
  // getBranding() here would be a second round trip to a row this query
  // already returns. `name` is NOT selected: that column is the agency's
  // internal label and `emailBrand` has no parameter left to receive it.
  // Read before anything downstream can reject, so even the suppression
  // refusal just below can speak the resolved language.
  const { data: account } = await db.from("accounts")
    .select("reply_to_email, from_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode, language")
    .eq("id", accountId).maybeSingle();

  // minors-1b item 1: the SAME resolver the record page and dashboard use for
  // the signed-in person's language (request-locale.ts) — never a locale the
  // client form supplies. An agency operator's own `users.language` wins
  // outright; a client-role sender (isOperator: false) falls back to the
  // account's own language before English.
  const prefs = await getPersonPrefs();
  // A named variable, not an inline literal: request-locale-callers.test.ts
  // scans each call's braces, and a nested literal there truncates the scan
  // at the inner brace.
  const accountLanguage = { language: (account?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language });

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
  if (suppressed) rejectSend(t(m, "automations.reason.accountSuppressed", locale));

  const convo = await ensureConversation(writer, accountId, contactId, userId);

  // Write-then-send: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message rather than a silent gap.
  const { id: messageId } = await createMessage(writer, accountId, {
    conversationId: convo.id, channel: "email", direction: "outbound",
    subject: subject || undefined, body,
  }, userId);

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
  const { userId, isAgency } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const body = normalizeLineBreaks(String(formData.get("body") ?? "")).trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  // The contact is read as the signed-in user under RLS: that read is what
  // proves the contact belongs to THIS account, and it authorises the
  // service-client writes below (0053).
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) rejectSend("contact not in account");

  // minors-1b item 1: the SAME resolver the record page/dashboard use for the
  // signed-in person's language — never a locale the client form supplies.
  // This action otherwise never touches `accounts`; one extra column, read on
  // the request client already in scope.
  const { data: langRow } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
  const prefs = await getPersonPrefs();
  // A named variable, not an inline literal — see the same comment in
  // sendEmailAction above.
  const accountLanguage = { language: (langRow?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language });

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
      case "a2p_not_approved": rejectSend(t(m, "compose.smsBlockedA2p", locale));
      case "no_live_number": rejectSend(t(m, "compose.smsBlockedNoNumber", locale));
      case "no_number": rejectSend(t(m, "compose.noPhoneOnContact", locale));
      // The render's own words for an unreadable state (review R3-M2): never
      // worded as the customer's choice, and never an open form.
      case "ledger_unavailable": rejectSend(t(m, "compose.smsStateUnknown", locale));
      // D-061: a suppressed account (a demo, or otherwise not real) refuses
      // every send — the composer says so plainly rather than silently
      // dropping the attempt, and nothing was written: `prepare` runs only
      // after the gate clears.
      case "suppressed_account": rejectSend(t(m, "automations.reason.accountSuppressed", locale));
      // M7a PR-4 (plan G7): a paused account's customer texts stop, the
      // composer's included; it says why rather than the generic failure.
      case "billing_paused": rejectSend(t(m, "compose.smsBlockedPaused", locale));
      default: rejectSend(composerBlockedLine(result.reason, locale));
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
    if (result.carrierBlocked) rejectSend(composerBlockedLine("stopped", locale));
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
  // M7a PR-4 (review I2): read state, so it stays usable while the account is paused. It revalidates
  // nothing: a revalidation re-renders the page inside this action's request, where the read-only guard
  // would refuse the render; MarkRead refreshes the page itself once this has landed.
  await requireAccountAccess(accountId, { duringPause: "allow" });
  // F-085 (spec §7.3): the service client below is not bound by RLS, so the
  // conversation is proven through the CALLER's own client first. Under 0068
  // a Technician cannot see another person's conversation, so the proof fails
  // with no role branching. A conversation the caller cannot see is a silent
  // no-op, the same answer another account's id already got; a proof that
  // cannot be read throws, never "allowed".
  if (!(await callerCanSee("conversations", accountId, conversationId))) return;
  // 0053: conversations are server-written. clearUnreadCount matches on
  // account_id AND id, and accountId is the one requireAccountAccess just
  // authorised, so another account's conversation id matches no row
  // (messaging.test.ts pins that with two real accounts).
  await clearUnreadCount(serviceDb(), accountId, conversationId);
}

// S-47e (E8, spec 5.12.5): staff move a shared number's holding thread to the right person, with Undo.
// Owners, Staff and the agency (the people who reply in the inbox), never a Technician. The SQL function
// (0098) checks the account and the holding side again; this proves what the caller may see first.
/** The Undo token: the move's own event and its two threads. The function reads the moved ids from that event
 *  (0098, plan P1), so nothing a browser sends can name a row. */
export type HoldingMoveUndo = { moveId: number; fromConversationId: string; toConversationId: string };
export type MoveHoldingResult =
  | { ok: true; toConversationId: string; name: string; undo: HoldingMoveUndo }
  | { ok: false; error: "conversation.holding.moveRole" | "conversation.holding.moveFailed" | "conversation.holding.moveEmpty" };
const MOVE_FAILED = { ok: false, error: "conversation.holding.moveFailed" } as const;
const MOVE_EMPTY = { ok: false, error: "conversation.holding.moveEmpty" } as const;
const MOVE_ROLE = { ok: false, error: "conversation.holding.moveRole" } as const;

export async function moveHoldingThreadAction(
  accountId: string, conversationId: string, toContactId: string,
): Promise<MoveHoldingResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return MOVE_ROLE;
  if (!isUuid(conversationId) || !isUuid(toContactId)) return MOVE_FAILED;
  try {
    if (!(await callerCanSee("conversations", accountId, conversationId))) return MOVE_FAILED;
    const db = await dbForRequest();
    const person = (await getContact(db, accountId, toContactId)) as
      { first_name: string | null; last_name: string | null; holds_shared_number?: boolean } | null;
    if (!person || person.holds_shared_number) return MOVE_FAILED;
    const svc = serviceDb();
    const target = await ensureConversation(svc, accountId, toContactId, access.userId, "user");
    const moved: HoldingMove = await moveHoldingThread(svc, accountId, { from: conversationId, to: target.id, actor: access.userId });
    if (moved.status === "empty") {
      // Someone, or another tab, moved them first (P32): say so, and refresh the inbox to show where they went.
      revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
      return MOVE_EMPTY;
    }
    if (moved.status !== "ok") return MOVE_FAILED;
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    return {
      ok: true, toConversationId: target.id,
      name: contactDisplayName({ first_name: person.first_name, last_name: person.last_name }),
      undo: { moveId: moved.moveId, fromConversationId: conversationId, toConversationId: target.id },
    };
  } catch (e) {
    console.error(`moveHoldingThreadAction (account ${accountId}): ${e instanceof Error ? e.message : String(e)}`);
    return MOVE_FAILED;
  }
}

export async function undoMoveHoldingThreadAction(
  accountId: string, undo: HoldingMoveUndo,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: "conversation.holding.moveRole" | "conversation.holding.moveFailed" }> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return MOVE_ROLE;
  if (!isUuid(undo?.fromConversationId) || !isUuid(undo?.toConversationId)
    || !Number.isSafeInteger(undo?.moveId) || undo.moveId <= 0) return MOVE_FAILED;
  try {
    const moved = await moveHoldingThread(serviceDb(), accountId, {
      from: undo.toConversationId, to: undo.fromConversationId, actor: access.userId, undoOf: undo.moveId,
    });
    if (moved.status !== "ok") return MOVE_FAILED;
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    return { ok: true, conversationId: undo.fromConversationId };
  } catch (e) {
    console.error(`undoMoveHoldingThreadAction (account ${accountId}): ${e instanceof Error ? e.message : String(e)}`);
    return MOVE_FAILED;
  }
}
