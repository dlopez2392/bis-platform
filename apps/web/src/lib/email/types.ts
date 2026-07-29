export type SendEmailInput = {
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
};

export type SendEmailResult = { providerMessageId: string };

export interface EmailProvider {
  /** True when this provider does not actually deliver mail. */
  readonly isFake: boolean;
  /** Set when a real provider is forced outside production; all mail goes here. */
  readonly redirectTo?: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
