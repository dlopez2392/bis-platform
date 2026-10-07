export type SendSmsInput = {
  /** E.164, e.g. "+19565551234". */
  to: string;
  /** E.164 of the account's own live number. */
  from: string;
  body: string;
};

export type SendSmsResult = { providerMessageId: string };

export interface SmsProvider {
  /** True when this provider does not actually deliver. */
  readonly isFake: boolean;
  /** Set when a real provider is forced outside production; all texts go here. */
  readonly redirectTo?: string;
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

/**
 * A send the provider REFUSED (a non-2xx answer), with what it said. `codes`
 * are the provider's own error codes from the body (Telnyx: `errors[].code`,
 * e.g. "40300" for a number that texted STOP), empty when the body carried
 * none or was not JSON. The message is unchanged from before this class
 * existed: it is what lands in `messages.error`.
 */
export class SmsProviderError extends Error {
  constructor(message: string, readonly status: number, readonly codes: readonly string[]) {
    super(message);
    this.name = "SmsProviderError";
  }
}
