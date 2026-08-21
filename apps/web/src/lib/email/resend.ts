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
      from: `${input.fromName} <${input.fromAddress ?? this.#fromAddress}>`,
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
