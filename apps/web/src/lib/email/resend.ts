import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

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
