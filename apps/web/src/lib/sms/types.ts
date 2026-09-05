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
