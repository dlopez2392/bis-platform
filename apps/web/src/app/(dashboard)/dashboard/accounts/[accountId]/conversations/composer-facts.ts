import type { SmsGate } from "@/lib/sms/sender";
import { composerStateLine, composerEmailNotice, type SmsRecipientState, type EmailRecipientState } from "@/lib/consent/composer-state";
import { e164Of } from "@/lib/voice/phone-number";
import type { Locale } from "@/lib/i18n/locale";
import { lastCustomerReply, startChannel, textReadiness, emailReadiness, type ThreadRow } from "./start-channel";

/**
 * S-06 part 3, spec §6: what the inbox's Text | Email composer is handed, decided on the SERVER from
 * the same reads the record page makes (record/page.tsx:91-121). The page passes thunks, so this module
 * never names a client: `contact` is getContact on the REQUEST client (RLS proves the customer), and
 * only then are the two recipient states read on the ledger client. Never throws.
 */
export type ComposerContact = { phone: string | null; email: string | null; phone_country_unconfirmed?: boolean | null };
export type InboxComposerFacts = {
  contactHasEmail: boolean; contactHasPhone: boolean; smsGate: SmsGate | null;
  smsBlockedLine: string | null; emailNoticeLine: string | null; initialMode: "sms" | "email";
};
export type InboxComposerDeps = {
  contact: () => Promise<ComposerContact | null>;
  /** softSmsGate: null on a failed read, never a throw. */
  gate: () => Promise<SmsGate | null>;
  /** smsRecipientState / emailRecipientState: never throw ("unknown" on a failed read). */
  smsState: (c: ComposerContact) => Promise<SmsRecipientState>;
  emailState: (c: ComposerContact) => Promise<EmailRecipientState>;
  log: (line: string) => void;
};

export async function loadInboxComposer(
  d: InboxComposerDeps, ctx: { messages: readonly ThreadRow[]; zone: string; locale: Locale },
): Promise<InboxComposerFacts> {
  let contact: ComposerContact | null = null;
  try {
    contact = await d.contact();
  } catch {
    d.log("the customer could not be read; the composer opens with nothing ready");
  }
  const smsGate = await d.gate();
  const [sms, email]: [SmsRecipientState, EmailRecipientState] = contact
    ? await Promise.all([d.smsState(contact), d.emailState(contact)])
    : [{ kind: "unknown" }, { kind: "unknown" }];
  const smsBlockedLine = contact ? composerStateLine(sms, ctx.zone, ctx.locale) : null;
  const emailNoticeLine = contact ? composerEmailNotice(email, ctx.zone, ctx.locale) : null;
  const phone = contact?.phone ?? null;
  return {
    contactHasEmail: Boolean(contact?.email),
    contactHasPhone: Boolean(e164Of(phone)),
    smsGate, smsBlockedLine, emailNoticeLine,
    initialMode: startChannel({
      lastReply: lastCustomerReply(ctx.messages),
      text: textReadiness({ phone, smsGate, smsBlockedLine, recipient: sms }),
      email: emailReadiness({ email: contact?.email ?? null, recipient: email }),
    }),
  };
}
