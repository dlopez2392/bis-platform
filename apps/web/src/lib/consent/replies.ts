import { getBranding, createMessage, updateMessageStatus, type SupabaseClient } from "@bis/db";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { segmentsFor } from "@/lib/sms/segments";
import { sendSms } from "./gate";
import type { ConsentReplyPlan } from "./inbound";

/**
 * The consent replies (spec §4.2's table): the ONE stop confirmation, the
 * start confirmation and the help reply, BIS's own words. BIS sends one only
 * when Telnyx did not already answer the keyword itself (plan G4); when Telnyx
 * did, the customer's reply IS the profile's configured text, which
 * `telnyxReplyText` gives for Task 16's step 0.
 */
export type ReplyKind = "consent.stop_confirmation" | "consent.start_confirmation" | "consent.help";

const LINES = {
  "consent.stop_confirmation": { en: ["sms.consentReply.stop.en", "sms.consentReply.stop.noName.en"], es: ["sms.consentReply.stop.es", "sms.consentReply.stop.noName.es"] },
  "consent.start_confirmation": { en: ["sms.consentReply.start.en", "sms.consentReply.start.noName.en"], es: ["sms.consentReply.start.es", "sms.consentReply.start.noName.es"] },
  "consent.help": { en: ["sms.consentReply.help.en", "sms.consentReply.help.noName.en"], es: ["sms.consentReply.help.es", "sms.consentReply.help.noName.es"] },
} as const satisfies Record<ReplyKind, Record<"en" | "es", readonly [keyof typeof m, keyof typeof m]>>;

/**
 * The HELP reply's support-contact phrase (TCR rejection 611: a HELP message
 * must name a real contact — email, phone or website — not just "this
 * number"). The account's own `reply_to_email` (Branding; a client sets it on
 * their own Settings page) wins when set: BIS's own domain has no business
 * appearing on a CLIENT's text once that client has a contact of its own.
 * With nothing set, BIS's fixed contact (owner decision, 2026-10-05) is the
 * floor every account ships with.
 *
 * Also the floor for a `reply_to_email` that would make the whole reply
 * carrier-UNcompliant in a different way: longer than 60 characters pushes
 * a message that is otherwise 1–2 segments well past the cap this file was
 * just rewritten to hold, and anything outside GSM-7 (an accented local
 * part, say) drops the WHOLE reply to UCS-2 at 70 characters a segment
 * (segments.ts) — either one is worse than naming BIS's contact instead of
 * the client's own.
 */
function isUsableContactEmail(email: string): boolean {
  return email.length <= 60 && segmentsFor(email).encoding === "gsm7";
}

function helpContactPhrase(language: "en" | "es", supportEmail: string | null | undefined): string {
  const email = supportEmail?.trim();
  if (!email || !isUsableContactEmail(email)) {
    return m[language === "es" ? "sms.consentReply.help.contact.fallback.es" : "sms.consentReply.help.contact.fallback.en"];
  }
  return language === "es" ? `escriba a ${email}` : `email ${email}`;
}

/**
 * The reply in the language asked, signed with the customer-facing name; a
 * blank name drops the prefix (see the catalogue comment on why that case is
 * not carrier-compliant, and is not "fixed" by signing with `accounts.name`
 * instead — DESIGN.md rule 8: that name is the agency's internal label, never
 * shown to a customer). `supportEmail` only matters for the help reply.
 */
export function consentReplyBody(kind: ReplyKind, language: "en" | "es", brandName: string, supportEmail?: string | null): string {
  const [named, nameless] = LINES[kind][language];
  const name = brandName.trim();
  const templated = name ? m[named].replace("{Business}", () => name) : m[nameless];
  return kind === "consent.help" ? templated.replace("{Contact}", () => helpContactPhrase(language, supportEmail)) : templated;
}

/**
 * The keywords each business's Telnyx profile lists: one bilingual config per
 * operation for each sender country, US, MX and CA (Task 16; plan F2, F3;
 * danlo 2026-09-28 — a Canadian +1 sender gets the named reply too). Every
 * stop word of decision 10 is in the stop config, so each one gets the
 * business-named reply below; START, UNSTOP and HELP are Telnyx's own
 * defaults, listed so their replies are ours.
 */
export const TELNYX_KEYWORDS = {
  stop: [
    "STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT",
    "PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS",
  ],
  start: ["START", "UNSTOP"],
  help: ["HELP", "AYUDA"],
} as const satisfies Record<"stop" | "start" | "help", readonly string[]>;

/** One bilingual reply per operation: the English line, then the Spanish line without its prefix (spec §5 step 0). */
export function telnyxReplyText(op: "stop" | "start" | "help", brandName: string, supportEmail?: string | null): string {
  const kind: ReplyKind = op === "stop" ? "consent.stop_confirmation" : op === "start" ? "consent.start_confirmation" : "consent.help";
  return `${consentReplyBody(kind, "en", brandName, supportEmail)} ${consentReplyBody(kind, "es", "", supportEmail)}`;
}

const ACTOR = "sms-inbound";

/**
 * Sends BIS's one reply (plan Task 9 runs this in `after()`, once the webhook
 * has answered): through the gate, as the carrier's own number (the sender
 * of the text it answers, never a stored flag), with the stop it answers for
 * the gate's one exception. Filed in the thread before it leaves when there
 * is a thread (the alert phone has none). NEVER THROWS: it runs after the
 * response, where a throw has no one to reach, so every outcome is logged.
 * Not billed (plan G11). The customer-facing name comes from the email
 * shell's `brandDisplayName`, as the text-back's does (textback.ts:35;
 * review R2-m6).
 *
 * The thread line is optional; the confirmation is not (review R2-I1b): a
 * filing that fails inside `prepare` is logged and the text still goes (the
 * gate treats a throw from `prepare` as "nothing leaves", gate.ts:191-195).
 * A status write that fails AFTER the send is logged as exactly that, never
 * as "not sent" (review R2-m5).
 */
export async function sendConsentReply(
  db: SupabaseClient,
  r: { accountId: string; to: string; contactId: string | null; conversationId: string | null; reply: ConsentReplyPlan },
): Promise<void> {
  try {
    const branding = await getBranding(db, r.accountId);
    const body = consentReplyBody(r.reply.kind, r.reply.language, brandDisplayName(branding), branding.replyToEmail);
    let messageId: string | null = null;
    const result = await sendSms(db, {
      accountId: r.accountId, kind: r.reply.kind, to: r.to, body, contactId: r.contactId,
      language: r.reply.language, numberFromCarrier: true,
      ...(r.reply.answersEventId ? { answersEventId: r.reply.answersEventId } : {}),
    }, {
      prepare: async ({ body: sent }) => {
        if (!r.conversationId) return;
        try {
          messageId = (await createMessage(db, r.accountId, {
            conversationId: r.conversationId, channel: "sms", direction: "outbound", body: sent,
          }, ACTOR, "system")).id;
        } catch (e) {
          console.error(`consent reply ${r.reply.kind} for account ${r.accountId}: not filed in the thread, sending anyway: ${loggableError(e)}`);
        }
      },
    });
    if (result.kind === "sent") {
      console.info(`consent reply ${r.reply.kind} for account ${r.accountId} sent`);
      if (messageId) {
        try {
          await updateMessageStatus(db, r.accountId, messageId, "sent", { providerMessageId: result.providerMessageId }, ACTOR, "system");
        } catch (e) {
          console.error(`consent reply ${r.reply.kind} for account ${r.accountId} sent, but its thread row was not marked sent: ${loggableError(e)}`);
        }
      }
      return;
    }
    if (result.kind === "failed" && messageId) {
      try {
        await updateMessageStatus(db, r.accountId, messageId, "failed", { error: result.error }, ACTOR, "system");
      } catch (e) {
        console.error(`consent reply ${r.reply.kind} for account ${r.accountId} failed, and its thread row was not marked failed: ${loggableError(e)}`);
      }
    }
    if (result.kind === "failed" && result.carrierBlocked) {
      // Review R2-I1c: a START Telnyx did not recognise (say "Start!") lifts
      // BIS's ledger, but Telnyx still blocks the number, refuses this
      // confirmation with 40300, and the gate has just recorded carrier_block
      // again. The ledger is right (the number IS blocked); the customer has
      // no reply and stays blocked until they send a START Telnyx matches.
      // Worded for both outcomes of the gate's write (review R2-m-d): it
      // appends carrier_block, or finds the customer's own stop already there.
      console.error(`consent reply ${r.reply.kind} for account ${r.accountId} not sent: the carrier refused it (40300): Telnyx still blocks this number, the gate records it as stopped (carrier_block, unless the customer's own stop already stands), and it stays blocked until the customer texts a START Telnyx itself recognises`);
      return;
    }
    const why = result.kind === "blocked" ? `blocked ${result.reason}` : result.kind === "failed" ? `failed ${result.stage}` : result.kind;
    console.error(`consent reply ${r.reply.kind} for account ${r.accountId} not sent: ${why}`);
  } catch (e) {
    console.error(`consent reply ${r.reply.kind} for account ${r.accountId} not sent: ${loggableError(e)}`);
  }
}
