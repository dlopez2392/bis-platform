import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";
import type { ReceivedEmail } from "./receiving";

class ResendEmailProvider implements EmailProvider {
  readonly isFake = false;
  readonly redirectTo?: string;
  #client: Resend;
  #fromAddress: string;

  constructor(apiKey: string, fromAddress: string, redirectTo?: string) {
    this.#client = new Resend(apiKey);
    this.#fromAddress = fromAddress;
    this.redirectTo = redirectTo;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const to = this.redirectTo ?? input.to;
    const { data, error } = await this.#client.emails.send({
      // `?.trim() ||`, deliberately NOT `??`. An empty string is neither null
      // nor undefined, so `??` would let it through and compose the malformed
      // header `Acme Corp <>` instead of falling back to the platform address.
      // Blank is not a value here — it means "no address given".
      //
      // The check lives in the provider rather than at each call site so it
      // cannot be bypassed by a caller that forgets to normalise, the lead
      // alert included. This repo has already paid for the other shape once:
      // `normalizeReplyTo` exists because an unset column is null, a cleared
      // form field is "", and a form with no email question yields "" — three
      // spellings of the same absence.
      from: `${input.fromName} <${input.fromAddress?.trim() || this.#fromAddress}>`,
      to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.body,
      // Spread rather than `html: input.html`, so a text-only send carries no
      // `html` key at all rather than an explicit undefined.
      ...(input.html ? { html: input.html } : {}),
      // Same spread discipline: a send without headers carries no key.
      ...(input.headers ? { headers: input.headers } : {}),
      // Same spread discipline again: a send with no tags (operator mail
      // with no account) carries no `tags` key at all.
      ...(input.tags ? { tags: input.tags } : {}),
    });
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("resend returned no message id");
    return { providerMessageId: data.id };
  }
}

export function resendEmailProvider(
  apiKey: string, fromAddress: string, redirectTo?: string,
): EmailProvider {
  return new ResendEmailProvider(apiKey, fromAddress, redirectTo);
}

/** The header block of a raw RFC 5322 message: everything before the first blank line. */
function headerBlock(raw: string): string {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? raw.slice(0, m.index) : raw;
}

/**
 * S-06 part 1: one received email by id (resend@6.18.1 `emails.receiving.get`, read in its type
 * definitions), plus the raw message's header block from `raw.download_url` (plan G5, ASSUMPTION A1).
 * THROWS on an API error (the webhook answers 503). A missing or unreadable raw message is `rawHeaders:
 * null`, never a throw: the sender then reads as unverified and the email is held.
 */
export async function fetchReceivedEmailFromResend(
  apiKey: string, emailId: string, fetchRaw: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<ReceivedEmail> {
  const { data, error } = await new Resend(apiKey).emails.receiving.get(emailId);
  if (error || !data) throw new Error(`resend receiving.get failed: ${error?.message ?? "no data"}`);
  let rawHeaders: string | null = null;
  if (data.raw?.download_url) {
    try {
      const res = await fetchRaw(data.raw.download_url);
      if (res.ok) rawHeaders = headerBlock(await res.text()) || null;
    } catch {
      rawHeaders = null;
    }
  }
  return {
    id: data.id, from: data.from, to: data.to ?? [], receivedFor: data.received_for ?? [],
    subject: data.subject || null, text: data.text, html: data.html, rawHeaders,
    attachmentCount: data.attachments?.length ?? 0, receivedAt: data.created_at,
  };
}
