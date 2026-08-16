export type SendEmailInput = {
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
  /** The rich part. Optional so every existing caller is unchanged: absent
   *  means a text-only send, exactly as before.
   *
   *  Never send this WITHOUT `body`. The text alternative is what keeps a
   *  branded message out of the spam bucket and readable in a text client, and
   *  it is composed deliberately by each template rather than derived by
   *  stripping tags. */
  html?: string;
};

export type SendEmailResult = { providerMessageId: string };

export interface EmailProvider {
  /** True when this provider does not actually deliver mail. */
  readonly isFake: boolean;
  /** Set when a real provider is forced outside production; all mail goes here. */
  readonly redirectTo?: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
